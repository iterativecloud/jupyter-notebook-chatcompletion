/* eslint-disable @typescript-eslint/naming-convention */

import axios from "axios";
import { ChatCompletionRequestMessage, Configuration, CreateChatCompletionRequest, OpenAIApi } from "openai";
import {
  CancellationToken,
  ConfigurationTarget,
  NotebookCellKind,
  NotebookEdit,
  NotebookRange,
  QuickPickItem,
  WorkspaceEdit,
  window,
  workspace,
} from "vscode";
import { appendTextToCell, convertCellsToMessages, insertCell } from "./cellUtils";
import { CompletionType } from "./completionType";
import { FinishReason } from "./finishReason";
import { bufferWholeChunks, streamChatCompletion } from "./streamUtils";
import { UIProgress } from "./uiProgress";
import { encoding_for_model } from "@dqbd/tiktoken";
import { configKeys, msgs, uiText } from "./constants";

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

  const msgText = JSON.stringify(messages);
  const totalTokenCount = countTokens(msgText, model);

  if (limit !== null && totalTokenCount > limit) {
    const tokenOverflow = limit - totalTokenCount;

    const msgText = messages.map((x) => x.content).join();
    const contentTokenCount = countTokens(msgText, model);

    const reducedMessages = await applyTokenReductionStrategies(messages, tokenOverflow, contentTokenCount, limit, model);

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

function addParametersFromMetadata(nbMetadata: any, reqParams: CreateChatCompletionRequest) {
  const e = window.activeNotebookEditor;
  if (e && nbMetadata) {
    if (e.notebook.metadata.custom?.top_p) {
      reqParams = {
        ...reqParams,
        top_p: e.notebook.metadata.custom.top_p,
      };
    }
    if (e.notebook.metadata.custom?.n) {
      reqParams = {
        ...reqParams,
        n: e.notebook.metadata.custom.n,
      };
    }
    if (e.notebook.metadata.custom?.max_tokens) {
      reqParams.max_tokens = e.notebook.metadata.custom.max_tokens;
    }
    if (e.notebook.metadata.custom?.presence_penalty) {
      reqParams = {
        ...reqParams,
        presence_penalty: e.notebook.metadata.custom.presence_penalty,
      };
    }
    if (e.notebook.metadata.custom?.frequency_penalty) {
      reqParams = {
        ...reqParams,
        frequency_penalty: e.notebook.metadata.custom.frequency_penalty,
      };
    }
    if (e.notebook.metadata.custom?.logit_bias) {
      reqParams = {
        ...reqParams,
        logit_bias: e.notebook.metadata.custom.logit_bias,
      };
    }
    if (e.notebook.metadata.custom?.user) {
      reqParams = {
        ...reqParams,
        user: e.notebook.metadata.custom.top_p,
      };
    }
  }
  return reqParams;
}

async function getOpenAIApiKey(): Promise<string> {
  let apiKey = workspace.getConfiguration().get<string>(configKeys.openAiKey);
  if (!apiKey) {
    apiKey = await window.showInputBox({
      prompt: msgs.enterApiKey,
      validateInput: (value) => (value.trim().length > 0 ? null : msgs.apiKeyCannotBeEmpty),
    });

    if (apiKey) {
      await workspace.getConfiguration().update(configKeys.openAiKey, apiKey, ConfigurationTarget.Global);

      await window.showInformationMessage(msgs.modelNotAccessible, { modal: true });
    } else {
      window.showErrorMessage(msgs.apiKeyRequired, { modal: true });
      return "";
    }
  }

  return apiKey;
}

type TokenReductionStrategy = QuickPickItem & {
  apply: Function;
  savedTokens?: number;
};

async function applyTokenReductionStrategies(
  messages: ChatCompletionRequestMessage[],
  tokenOverflowCount: number,
  totalTokenCount: number,
  limit: number,
  model: string
): Promise<ChatCompletionRequestMessage[] | null> {
  let strategies: TokenReductionStrategy[] = [
    {
      label: uiText.removeOutput,
      apply: async () => {
        return messages.filter((message) => !message.content.startsWith("Output from previous code:"));
      },
    },
    {
      label: uiText.removeProblems,
      apply: async () => {
        return messages.filter((message) => !message.content.startsWith("Problems reported by VSCode from previous code:"));
      },
    },
    {
      label: uiText.removeSpaces,
      apply: async () => {
        return messages.map((message) => ({
          ...message,
          content: message.content.replace(/ /g, ""),
        }));
      },
    },
    {
      label: uiText.removeLineBreaks,
      apply: async () => {
        return messages.map((message) => ({
          ...message,
          content: message.content.replace(/\n/g, ""),
        }));
      },
    },
    {
      label: uiText.removePunctuation,
      apply: async () => {
        return messages.map((message) => ({
          ...message,
          content: message.content.replace(/[.,;:!?]/g, ""),
        }));
      },
    },
  ];

  for (const strategy of strategies) {
    const reducedMessages = await strategy.apply();
    const reducedTokenCount = countTotalTokens(reducedMessages, model);
    const savedTokens = totalTokenCount - reducedTokenCount;
    strategy.savedTokens = savedTokens;
    strategy.description = `${savedTokens} tokens`;
  }

  strategies = strategies.filter((s) => (s.savedTokens ? s.savedTokens > 1 : false));

  const maxPossibleSaving = strategies.map((x) => x.savedTokens ?? 0).reduce((prev, current) => prev + current);

  if (maxPossibleSaving < tokenOverflowCount) {
    window.showInformationMessage(
      `If we applied every token reduction strategy available, you would still be ${
        tokenOverflowCount - maxPossibleSaving
      } over the limit of the '${model}' model. Please reduce the size of the content.`,
      { modal: true }
    );
  }

  const selectedStrategies = await window.showQuickPick(strategies, {
    canPickMany: true,
    title: uiText.tooManyTokens,
    placeHolder: uiText.tooManyTokensPlaceholder,
  });

  if (!selectedStrategies) {
    return null;
  }

  let reducedMessages = messages;
  for (const strategy of selectedStrategies) {
    reducedMessages = await strategy.apply(reducedMessages);
  }

  const reducedTokenCount = countTotalTokens(reducedMessages, model);
  if (reducedTokenCount > limit) {
    window.showErrorMessage(msgs.notEnoughSavings);
    return null;
  }

  return reducedMessages;
}

function countTokens(text: string, model: any): number {
  const enc = encoding_for_model(model);
  const tokenCount = enc.encode(text).length;
  enc.free();
  return tokenCount;
}

function countTotalTokens(msgs: ChatCompletionRequestMessage[], model: string): number {
  return msgs.reduce((accumulator, message) => {
    return accumulator + countTokens(message.content, model);
  }, 0);
}
