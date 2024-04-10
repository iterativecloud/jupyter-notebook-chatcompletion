import { TiktokenModel, encoding_for_model } from "@dqbd/tiktoken";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { QuickPickItem, window } from "vscode";
import { Constants } from "../Constants";
import OpenAI from "openai";

function tabifyWhitespaces(message: ChatCompletionMessageParam): ChatCompletionMessageParam {
  message.content = message.content?.toString().replace(/ {4}/g, "\t");
  return message;
}

export async function applyTokenReductions(
  messages: ChatCompletionMessageParam[],
  tokenOverflowCount: number,
  limit: number,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  model: TiktokenModel
): Promise<ChatCompletionMessageParam[] | null> {
  const replacements: { label: string; reduce: (message: ChatCompletionMessageParam) => ChatCompletionMessageParam | null }[] = [
    {
      label: Constants.removeOutput,
      reduce: (m) => (m.content!.toString().includes(Constants.messageMetadata.jupyterCodeCellOutput) ? null : m),
    },
    {
      label: Constants.removeProblems,
      reduce: (m) => (m.content!.toString().includes(Constants.messageMetadata.jupyterCodeCellProblems) ? null : m),
    },
    {
      label: Constants.removeCodeCells,
      reduce: (m) => (m.content!.toString().includes(Constants.messageMetadata.jupyterCodeCell) ? null : m),
    },
    { label: Constants.removeSystemMsg, reduce: (m) => (m.role === "system" ? null : m) },
  ];

  type TokenReductionStrategy = QuickPickItem & {
    apply: Function;
    savedTokens?: number;
  };

  let strategies: TokenReductionStrategy[] = replacements.map((strategy) => ({
    label: strategy.label,
    apply: () => messages.map(strategy.reduce).filter((x) => x !== null),
  }));

  const totalTokenCount = countTokens(messages, tools, model);

  for (const strategy of strategies) {
    const reducedMessages = await strategy.apply();
    const reducedTokenCount = countTokens(reducedMessages, tools, model);
    const savedTokens = totalTokenCount - reducedTokenCount;
    strategy.savedTokens = savedTokens;
    strategy.description = `${savedTokens} tokens`;
  }

  const selectedStrategies = await window.showQuickPick(strategies, {
    ignoreFocusOut: true,
    canPickMany: true,
    title: `You have ${tokenOverflowCount} more tokens than the model's limit of ${limit}`,
  });

  if (!selectedStrategies) {
    return null;
  }

  let reducedMessages = messages;
  for (const strategy of selectedStrategies) {
    reducedMessages = await strategy.apply(reducedMessages);
  }

  return reducedMessages;
}

export function countTokens(messages: any[], tools: OpenAI.Chat.Completions.ChatCompletionTool[], model: TiktokenModel): number {
  const encoding = encoding_for_model(model);
  let tokensPerMessage = 4;
  let tokensPerName = 1;

  let numTokens = 0;
  for (const message of messages) {
    numTokens += tokensPerMessage;
    for (const key in message) {
      let value = message[key];
      if (typeof value !== "string") {
        value = JSON.stringify(value);
      }

      numTokens += encoding.encode(value).length;
      if (key === "name") {
        numTokens += tokensPerName;
      }
    }
  }

  for (const tool of tools) {
    const value = JSON.stringify(tool);
    numTokens += encoding.encode(value).length;
  }

  numTokens += 3;
  return numTokens;
}

export function getTokenLimit(model: string): number | null {
  switch (model) {
    case "gpt-3.5-turbo":
    case "gpt-3.5-turbo-0125":
    case "gpt-3.5-turbo-1106":
    case "gpt-3.5-turbo-instruct":
    case "gpt-3.5-turbo-0613":
    case "gpt-4-0125-preview":
    case "gpt-4-turbo-preview":
    case "gpt-4-1106-preview":
    case "gpt-4-vision-preview":
    case "gpt-4-1106-vision-preview":
      return 4096;
    case "gpt-3.5-turbo-16k":
    case "gpt-3.5-turbo-16k-0613":
      return 16385;
    case "gpt-4-32k":
    case "gpt-4-32k-0613":
      return 32768;
    case "gpt-4":
    case "gpt-4-0613":
      return 8192;
    default:
      // if we don't know the model, we return null to signal no applicable limit
      return null;
  }
}

export function getValidAlternativeIfAvailable(model: string): TiktokenModel {
  // For new models we know exists but are not known by Tiktoken, we choose a suitable alternative
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
