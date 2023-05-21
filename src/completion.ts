/* eslint-disable @typescript-eslint/naming-convention */
import axios from "axios";
import { Configuration, CreateChatCompletionRequest, OpenAIApi } from "openai";
import { CancellationToken, NotebookCellKind, NotebookEdit, NotebookRange, WorkspaceEdit, window, workspace } from "vscode";
import { appendTextToCell, convertCellsToMessages, insertCell } from "./cellUtils";
import { CompletionType } from "./completionType";
import { getOpenAIApiKey, getTokenLimit } from "./config";
import { msgs } from "./constants";
import { FinishReason } from "./finishReason";
import { bufferWholeChunks, streamChatCompletion } from "./streamUtils";
import { applyTokenReductions, countTokens } from "./tokenUtils";
import { UIProgress } from "./uiProgress";

const output = window.createOutputChannel("Notebook ChatCompletion");

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

  const nbMetadata = e.notebook.metadata.custom;

  const defaultModel = workspace.getConfiguration().get<string>("notebook-chatcompletion.defaultModel");

  const model = nbMetadata?.model ?? defaultModel;
  const temperature = nbMetadata?.temperature ?? 0;

  const limit = getTokenLimit(model);

  const msgText = JSON.stringify(messages);
  const totalTokenCount = countTokens(msgText, model);

  if (limit !== null && totalTokenCount > limit) {
    const tokenOverflow = limit - totalTokenCount;

    const msgText = messages.map((x) => x.content).join();
    const contentTokenCount = countTokens(msgText, model);

    const reducedMessages = await applyTokenReductions(messages, tokenOverflow, contentTokenCount, limit, model);

    if (!reducedMessages) {
      return FinishReason.cancelled;
    }

    messages = reducedMessages;
  }

  let reqParams: CreateChatCompletionRequest = {
    model: model,
    messages: messages,
    stream: true,
    temperature: temperature,
  };

  if (limit) {
    const reducedMsgText = JSON.stringify(messages);
    const reducedTokenCount = countTokens(reducedMsgText, model);
    reqParams.max_tokens = limit - reducedTokenCount;

    if (reqParams.max_tokens < 1) {
      const result = await window.showInformationMessage(
        `The request is estimated to be ${-reqParams.max_tokens} tokens over the limit (including the input) and will likely be rejected from the OpenAI API. Do you still want to proceed?`,
        { modal: true },
        "Yes"
      );
      if (result !== "Yes") {
        return FinishReason.cancelled;
      }
    }
  }

  reqParams = addParametersFromMetadata(nbMetadata, reqParams);

  output.appendLine("\n" + JSON.stringify(reqParams, undefined, 2) + "\n");
  progress.report({ increment: 1, message: msgs.sendingRequest });

  const response = await openai.createChatCompletion(reqParams, {
    cancelToken: tokenSource.token,
    responseType: "stream",
  });

  for await (let textToken of bufferWholeChunks(streamChatCompletion(response, cancelToken))) {
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

      const currentCell = e.notebook.cellAt(cellIndex);
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

      cellIndex = await insertCell(e, cellIndex, ck, "python");
      textToken = textToken.replace("```python\n", "");
    } else if (textToken.includes("```") && ck === NotebookCellKind.Code) {
      textToken = textToken.replace("```", "");

      ck = NotebookCellKind.Markup;
      cellIndex = await insertCell(e, cellIndex, ck);
    }

    if (ck === undefined) {
      cellIndex = await insertCell(e, cellIndex, NotebookCellKind.Markup);
      ck = NotebookCellKind.Markup;
    }

    await appendTextToCell(e, cellIndex, textToken);

    progress.report({ increment: 0.5, message: msgs.receivingTokens });
  }

  return FinishReason.length;
}

type ExtendedCreateChatCompletionRequest = CreateChatCompletionRequest & {
  [key: string]: any;
};

function addParametersFromMetadata(nbMetadata: any, reqParams: CreateChatCompletionRequest) {
  const requestParams = [
    "top_p",
    "n",
    "max_tokens",
    "presence_penalty",
    "frequency_penalty",
    "logit_bias",
    "user"
  ];

  const extendedReqParams: ExtendedCreateChatCompletionRequest = reqParams;

  for (const [metadataKey, reqParamKey] of Object.entries(requestParams)) {
    if (nbMetadata && nbMetadata[metadataKey]) {
      extendedReqParams[reqParamKey] = nbMetadata[metadataKey];
    }
  }

  return reqParams;
}
