import { TiktokenModel } from "@dqbd/tiktoken";
import OpenAI from "openai";
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "openai/resources";
import { CancellationToken, NotebookCellKind, window } from "vscode";
import { convertCellsToMessages } from "./utilities/cellUtils";
import { CompletionType } from "./completionType";
import { addParametersFromMetadata as addNotebookConfigParams, getOpenAIApiKey, getTokenLimit } from "./config";
import { msgs, tools } from "./constants";
import { FinishReason } from "./finishReason";
import { applyTokenReductions, countTokens } from "./utilities/tokenUtils";
import { UIProgress, waitForUIDispatch } from "./uiProgress";
import { getValidAlternativeIfAvailable, output, streamResponse } from "./completion";
import { findFilesTool } from "./tools/findFilesTool";
import { ToolCallWithResult } from "./toolCallWithResult";
import { App } from "./viewmodels/App";

export async function generateCompletion(
  cellIndex: number,
  completionType: CompletionType,
  progress: UIProgress,
  functionCallResults: ToolCallWithResult[],
  cancelToken: CancellationToken
): Promise<FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[]> {
  const e = window.activeNotebookEditor!;
  let messages = await convertCellsToMessages(cellIndex, completionType);
  let ck: NotebookCellKind | undefined = undefined;

  const openaiApiKey = await getOpenAIApiKey();

  if (!openaiApiKey) {
    throw new Error(msgs.apiKeyNotSet);
  }

  // Add previous function call results if any have been passed to this function
  if (functionCallResults.length > 0) {
    functionCallResults.forEach((funcResult) => {
      const assistantMessage: ChatCompletionAssistantMessageParam = {
        name: funcResult.function!.name!,
        role: "assistant",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        tool_calls: [
          {
            id: funcResult.id!,
            type: funcResult.type!,
            function: { name: funcResult.function!.name!, arguments: funcResult.function!.arguments! },
          },
        ],
      };

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const toolMessage: ChatCompletionToolMessageParam = { role: "tool", content: funcResult.result, tool_call_id: funcResult.id! };

      messages.push(assistantMessage);
      messages.push(toolMessage);
    });
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  let nbMetadata = e.notebook.metadata.custom;

  if (!nbMetadata?.model) {
    const result = await App.current.setOpenAIModel();
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

  const currentTools: ChatCompletionTool[] = tools.map((tool) => {
    const func: ChatCompletionTool = {
      type: "function",
      function: {
        name: tool.toolName,
        description: tool.toolDescription,
        parameters: {
          type: "object",
          properties: tool.properties,
          required: tool.required,
        },
      },
    };
    return func;
  });

  try {
    const totalTokenCount = countTokens(messages, currentTools, knownTikTokenModel);

    if (limit !== null && totalTokenCount > limit) {
      const tokenOverflow = totalTokenCount - limit;

      progress.report({ message: msgs.calculatingTokeReductions, increment: 1 });
      await waitForUIDispatch();

      const reducedMessages = await applyTokenReductions(messages, tokenOverflow, limit, currentTools, knownTikTokenModel);

      if (!reducedMessages) {
        return FinishReason.cancelled;
      }

      messages = reducedMessages;
    }
  } catch (error: any) {
    skipTokenization = true;
    window.showWarningMessage("Error while counting tokens - skipping token limit checks", {
      modal: false,
      detail:
        "We couldn't count the tokens. This can happen for newer, unknown models (this extension has to be updated).\n" + error.message,
    });
  }

  let reqParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
    model: model,
    messages: messages,
    temperature: temperature,
    tools: currentTools,
    stream: true,
  };

  if (limit) {
    if (!skipTokenization) {
      const reducedTokenCount = countTokens(messages, currentTools, knownTikTokenModel);
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

  output.appendLine("___Request____________________________________");
  output.appendLine("\n" + JSON.stringify(reqParams, null, 2));
  progress.report({ increment: 1, message: msgs.sendingRequest });

  const stream = await openai.chat.completions.create(reqParams);
  return await streamResponse(stream, cancelToken, cellIndex, ck, progress);
}
