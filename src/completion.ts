import axios from "axios";
import {
  ChatCompletionRequestMessage,
  Configuration,
  CreateChatCompletionRequest,
  OpenAIApi,
} from "openai";
import {
  CancellationToken,
  ConfigurationTarget,
  NotebookCellKind,
  NotebookEdit,
  NotebookEditor,
  NotebookRange,
  WorkspaceEdit,
  window,
  workspace,
} from "vscode";
import {
  appendTextToCell,
  convertCellsToMessages,
  insertCell,
} from "./cellUtils";
import { CompletionType } from "./completionType";
import { FinishReason } from "./finishReason";
import { bufferWholeChunks, streamChatCompletion } from "./streamUtils";
import { UIProgress } from "./uiProgress";
import { get_encoding, encoding_for_model } from "@dqbd/tiktoken";

const SENDING_COMPLETION_REQUEST = "Sending ChatCompletion request";
const RECEIVING_TOKENS = "Receiving tokens...";
const pythonCodeBlockStart = "```python\n";
const codeBlockEnd = "```";

export const output = window.createOutputChannel("Notebook ChatCompletion");

export async function generateCompletion(
  cellIndex: number,
  completionType: CompletionType,
  progress: UIProgress,
  token: CancellationToken,
  previousFinishReason: FinishReason
): Promise<FinishReason> {
  const editor = window.activeNotebookEditor!;
  const messages = await convertCellsToMessages(cellIndex, completionType);
  let currentKind: NotebookCellKind | undefined = undefined;

  const openAIApiKey = await getOpenAIApiKey();

  if (!openAIApiKey) {
    throw new Error("OpenAI API key is not set");
  }

  const openai = new OpenAIApi(new Configuration({ apiKey: openAIApiKey }));

  const tokenSource = axios.CancelToken.source();
  token.onCancellationRequested(() => tokenSource.cancel());

  const notebookMetadata = editor.notebook.metadata.custom;

  // Model and temperature are the only parameters we define defaults for.
  // Otherwise, everything else is left untouched if not defined
  const defaultModel = workspace
    .getConfiguration()
    .get<string>("notebook-chatcompletion.defaultModel");

  const model = notebookMetadata?.model ?? defaultModel;
  const temperature = notebookMetadata?.temperature ?? 0;

  const enc = encoding_for_model(model);
  // for (let i = 0; i < messages.length; i++) {
  //   const encodedMessage = enc.encode(messages[i].content);
  //   messages[i].tokenCount = encodedMessage.length;
  // }

  // const oldtotalTokenCount = messages.reduce(
  //   (total, message) => total + (message.tokenCount ?? 0),
  //   0
  // );

  const msgText = JSON.stringify(messages);
  const totalTokenCount = enc.encode(msgText).length;

  enc.free();

  let limit: number | null = null;

  switch (model) {
    case "gpt-4":
    case "gpt-4-0314":
      limit = 8192;
      break;

    case "gpt-4-32k":
    case "gpt-4-32k-0314":
      limit = 32768;
      break;

    case "gpt-3.5-turbo":
    case "gpt-3.5-turbo-0301":
      limit = 4096;
      break;

    default:
      break;
  }

  if (limit !== null && totalTokenCount > limit) {
    const message = `You are sending ${totalTokenCount} tokens, which is ${
      totalTokenCount - limit
    } more than the limit of ${limit} for the ${model} model`;

    await window.showInformationMessage(message, { modal: true });
    return FinishReason.cancelled;
  }

  let requestParams: CreateChatCompletionRequest = {
    model: model,
    messages,
    stream: true,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    temperature: temperature,
  };

  if (limit) {
    requestParams.max_tokens = Math.max(1, limit - totalTokenCount);
  }

  requestParams = addParametersFromMetadata(notebookMetadata, requestParams);

  output.appendLine("\n" + JSON.stringify(requestParams, undefined, 2) + "\n");
  progress.report({ increment: 1, message: SENDING_COMPLETION_REQUEST });

  const response = await openai.createChatCompletion(requestParams, {
    cancelToken: tokenSource.token,
    responseType: "stream",
  });

  for await (let textToken of bufferWholeChunks(
    streamChatCompletion(response, token)
  )) {
    // debug output of FinishReaseon
    if (Object.values(FinishReason).includes(textToken as FinishReason)) {
      switch (textToken) {
        case FinishReason.length:
          output.append("FINISH_REASON_LENGTH" + "\n");
          break;
        case FinishReason.contentFilter:
          output.append("FINISH_REASON_CONTENTFILTER" + "\n");
          break;
        case FinishReason.stop:
          output.append("FINISH_REASON_STOP" + "\n");
          break;
      }

      const currentCell = editor.notebook.cellAt(cellIndex);
      const text = currentCell.document.getText();

      // we're wrapping up and may find out that the last cell only contains whitespaces or linesbreak.
      // in that case, we retroactively removed that last empty cell
      if (!/\S/.test(text)) {
        const edit = new WorkspaceEdit();
        edit.set(currentCell.notebook.uri, [
          NotebookEdit.deleteCells(
            new NotebookRange(currentCell.index, currentCell.index + 1)
          ),
        ]);
        await workspace.applyEdit(edit);
      }

      return textToken as FinishReason;
    } else {
      // Debug output of text
      output.append(textToken.toString());
    }

    if (typeof textToken !== "string") {
      throw new Error("Invalid state: unknown stream result: " + textToken);
    }

    if (textToken.includes(pythonCodeBlockStart)) {
      // we have yet to support polyglot notebooks, so for now we treat everything that isn't
      // python as markdown. Still, we make a dedicated cell for that block.
      currentKind = NotebookCellKind.Code;

      cellIndex = await insertCell(editor, cellIndex, currentKind, "python");
      textToken = textToken.replace(pythonCodeBlockStart, "");
    } else if (
      textToken.includes(codeBlockEnd) &&
      currentKind === NotebookCellKind.Code
    ) {
      textToken = textToken.replace(codeBlockEnd, "");

      // if after removing the backticks we still got some remaining that isn't linebreaks or whitespaces,
      // we create a new markdown cell
      currentKind = NotebookCellKind.Markup;
      cellIndex = await insertCell(editor, cellIndex, currentKind, "markdown");
    }

    if (currentKind === undefined) {
      // we assume we are just getting started with a first markdown cell
      cellIndex = await insertCell(
        editor,
        cellIndex,
        NotebookCellKind.Markup,
        "markdown"
      );
      currentKind = NotebookCellKind.Markup;
    }

    // write token
    await appendTextToCell(editor, cellIndex, textToken);

    progress.report({ increment: 0.5, message: RECEIVING_TOKENS });
  }

  // We came to the end of the string without ever receiving a FinishReason from the API (or we have a bug).
  // Especially when the API interrupts inbetween code and the server-side max token limit is reached, this may happen.
  // When the client-side max token limit is reached, we usually get an appropriate FinishReason.
  // We therefore interpret the behavior as Finish Reason Length.
  return FinishReason.length;
}

function addParametersFromMetadata(
  notebookMetadata: any,
  requestParams: CreateChatCompletionRequest
) {
  const editor = window.activeNotebookEditor;
  if (editor && notebookMetadata) {
    if (editor.notebook.metadata.custom?.top_p) {
      requestParams = {
        ...requestParams,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        top_p: editor.notebook.metadata.custom.top_p,
      };
    }
    if (editor.notebook.metadata.custom?.n) {
      requestParams = {
        ...requestParams,
        n: editor.notebook.metadata.custom.n,
      };
    }
    if (editor.notebook.metadata.custom?.max_tokens) {
      requestParams.max_tokens = editor.notebook.metadata.custom.max_tokens;
    }
    if (editor.notebook.metadata.custom?.presence_penalty) {
      requestParams = {
        ...requestParams,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        presence_penalty: editor.notebook.metadata.custom.presence_penalty,
      };
    }
    if (editor.notebook.metadata.custom?.frequency_penalty) {
      requestParams = {
        ...requestParams,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        frequency_penalty: editor.notebook.metadata.custom.frequency_penalty,
      };
    }
    if (editor.notebook.metadata.custom?.logit_bias) {
      requestParams = {
        ...requestParams,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        logit_bias: editor.notebook.metadata.custom.logit_bias,
      };
    }
    if (editor.notebook.metadata.custom?.user) {
      requestParams = {
        ...requestParams,
        user: editor.notebook.metadata.custom.top_p,
      };
    }
  }
  return requestParams;
}

async function getOpenAIApiKey(): Promise<string> {
  let openaiApiKey = workspace
    .getConfiguration()
    .get<string>("notebook-chatcompletion.openaiApiKey");
  if (!openaiApiKey) {
    // Prompt the user to enter the API key
    openaiApiKey = await window.showInputBox({
      prompt: "Enter your OpenAI API Key:",
      validateInput: (value) =>
        value.trim().length > 0 ? null : "API Key cannot be empty",
    });

    // Save the API key to the extension settings
    if (openaiApiKey) {
      await workspace
        .getConfiguration()
        .update(
          "notebook-chatcompletion.openaiApiKey",
          openaiApiKey,
          ConfigurationTarget.Global
        );

      await window.showInformationMessage(
        "Please note that the model is set to GPT-4 by default, which you may not be able to access yet. As a result, the API may return an HTTP 404 error. You can change the 'Default Model' setting to another model or use the 'Set Model' command in the menu to set the model for a specific notebook.",
        { modal: true }
      );
    } else {
      // If the user didn't provide an API key, show an error message and return
      window.showErrorMessage(
        "OpenAI API Key is required for Notebook ChatCompletion to work.",
        { modal: true }
      );
      return "";
    }
  }

  return openaiApiKey;
}
