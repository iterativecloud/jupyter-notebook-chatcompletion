import axios, { AxiosResponse } from "axios";
import { Configuration, CreateChatCompletionRequest, CreateChatCompletionResponse, OpenAIApi } from "openai";
import { CancellationToken, NotebookCellKind, NotebookEdit, NotebookRange, WorkspaceEdit, window, workspace } from "vscode";
import { appendTextToCell, convertCellsToMessages, insertCell } from "./cellUtils";
import { CompletionType } from "./completionType";
import { addParametersFromMetadata as addNotebookConfigParams, getOpenAIApiKey, getTokenLimit } from "./config";
import { msgs } from "./constants";
import { FinishReason } from "./finishReason";
import { bufferWholeChunks, streamChatCompletion } from "./streamUtils";
import { applyTokenReductions, countTokens } from "./tokenUtils";
import { UIProgress, waitForUIDispatch } from "./uiProgress";
import { TiktokenModel } from "@dqbd/tiktoken";
import { setModel } from "./extension";

const output = window.createOutputChannel("Notebook ChatCompletion");

async function streamResponse(
  response: AxiosResponse<CreateChatCompletionResponse, any>,
  cancelToken: CancellationToken,
  cellIndex: number,
  ck: NotebookCellKind | undefined,
  progress: UIProgress
) {
  const editor = window.activeNotebookEditor!;
  output.show(true);

  for await (let textToken of bufferWholeChunks(streamChatCompletion(response, cancelToken))) {
    if (Object.values(FinishReason).includes(textToken as FinishReason)) {
      const currentCell = window.activeNotebookEditor!.notebook.cellAt(cellIndex);
      const text = currentCell.document.getText();

      if (!/\S/.test(text)) {
        const edit = new WorkspaceEdit();
        edit.set(currentCell.notebook.uri, [NotebookEdit.deleteCells(new NotebookRange(currentCell.index, currentCell.index + 1))]);
        await workspace.applyEdit(edit);
      }

      return textToken as FinishReason;
    } else {
      output.append(textToken.toString());
    }

    if (typeof textToken !== "string") {
      throw new Error(`Unknown stream result: ${textToken}`);
    }

    if (textToken.includes("```python\n")) {
      ck = NotebookCellKind.Code;

      cellIndex = await insertCell(editor, cellIndex, ck, "python");
      textToken = textToken.replace("```python\n", "");
    } else if (textToken.includes("```") && ck === NotebookCellKind.Code) {
      textToken = textToken.replace("```", "");

      ck = NotebookCellKind.Markup;
      cellIndex = await insertCell(editor, cellIndex, ck);
    }

    if (ck === undefined) {
      cellIndex = await insertCell(editor, cellIndex, NotebookCellKind.Markup);
      ck = NotebookCellKind.Markup;
    }

    await appendTextToCell(editor, cellIndex, textToken);

    progress.report({ increment: 0.5, message: msgs.receivingTokens });
  }

  return FinishReason.length;
}

function getValidAlternativeIfAvailable(model: string): TiktokenModel {
  // For new models we know already exists but are not yet known by Tiktoken (needs update), we choose a valid alternative model ourselves.
  switch (model) {
    case "gpt-3.5-turbo-16k-0613":
    case "gpt-3.5-turbo-0613":
    case "gpt-3.5-turbo-16k":
      return "gpt-3.5-turbo";

    case "gpt-4-0613":
    case "gpt-4-32k-0613":
      return "gpt-4";

    default:
      return model as TiktokenModel;
  }
}

export async function generateCompletion(
  cellIndex: number,
  completionType: CompletionType,
  progress: UIProgress,
  cancelToken: CancellationToken
): Promise<FinishReason> {
  const e = window.activeNotebookEditor!;
  let messages = await convertCellsToMessages(cellIndex, completionType);
  let ck: NotebookCellKind | undefined = undefined;

  const openaiApiKey = await getOpenAIApiKey();

  if (!openaiApiKey) {
    throw new Error(msgs.apiKeyNotSet);
  }

  const openai = new OpenAIApi(new Configuration({ apiKey: openaiApiKey }));

  const tokenSource = axios.CancelToken.source();
  cancelToken.onCancellationRequested(tokenSource.cancel);

  let nbMetadata = e.notebook.metadata.custom;

  if (!nbMetadata?.model) {
    const result = await setModel();
    if (result) {
      nbMetadata = e.notebook.metadata.custom;
    } else {
      throw new Error(msgs.modelNotSet);
    }
  }

  const model: TiktokenModel = nbMetadata?.model;
  let knownTikTokenModel: TiktokenModel = getValidAlternativeIfAvailable(model);

  const temperature = nbMetadata?.temperature ?? 0;
  const limit = getTokenLimit(model);

  progress.report({ message: msgs.calculatingTokens, increment: 1 });
  await waitForUIDispatch();

  let skipTokenization = false;

  try {
    const totalTokenCount = countTokens(messages, knownTikTokenModel);

    if (limit !== null && totalTokenCount > limit) {
      const tokenOverflow = totalTokenCount - limit;

      progress.report({ message: msgs.calculatingTokeReductions, increment: 1 });
      await waitForUIDispatch();

      const reducedMessages = await applyTokenReductions(messages, tokenOverflow, limit, knownTikTokenModel);

      if (!reducedMessages) {
        return FinishReason.cancelled;
      }

      messages = reducedMessages;
    }
  } catch (error: any) {
    skipTokenization = true;
    await window.showWarningMessage("Error while counting tokens - skipping token limit checks", {
      modal: true,
      detail:
        "This can happen with newer, unknown models (this extension has to be updated). Checking for token limits and suggesting token reduction strategies will be skipped.\n" +
        error.message,
    });
  }

  let reqParams: CreateChatCompletionRequest = {
    model: model,
    messages: messages,
    stream: true,
    temperature: temperature,
  };

  if (limit) {
    if (!skipTokenization) {
      const reducedTokenCount = countTokens(messages, knownTikTokenModel);
      reqParams.max_tokens = limit - reducedTokenCount;
    }

    if (reqParams.max_tokens && reqParams.max_tokens < 1) {
      const result = await window.showInformationMessage(
        `The request is estimated to be ${-reqParams.max_tokens} tokens over the limit (including the input) and will likely be rejected from the OpenAI API. Do you still want to proceed?`,
        { modal: true },
        "Yes"
      );
      if (result !== "Yes") {
        return FinishReason.cancelled;
      } else {
        // The user still wants to send the requests despite the going over the limit. In that case we completely remove the max_tokens parameter.
        reqParams.max_tokens = undefined;
      }
    }
  }

  reqParams = addNotebookConfigParams(nbMetadata, reqParams);

  output.appendLine("\n" + JSON.stringify(reqParams, undefined, 2) + "\n");
  progress.report({ increment: 1, message: msgs.sendingRequest });

  const response = await openai.createChatCompletion(reqParams, {
    cancelToken: tokenSource.token,
    responseType: "stream",
  });

  return await streamResponse(response, cancelToken, cellIndex, ck, progress);
}
