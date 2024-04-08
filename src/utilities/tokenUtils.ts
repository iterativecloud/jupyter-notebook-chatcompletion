import { TiktokenModel, encoding_for_model } from "@dqbd/tiktoken";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { QuickPickItem, window } from "vscode";
import { messageMetadata, uiText } from "../constants";
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
    { label: uiText.removeOutput, reduce: (m) => (m.content!.toString().includes(messageMetadata.jupyterCodeCellOutput) ? null : m) },
    { label: uiText.removeProblems, reduce: (m) => (m.content!.toString().includes(messageMetadata.jupyterCodeCellProblems) ? null : m) },
    { label: uiText.removeCodeCells, reduce: (m) => (m.content!.toString().includes(messageMetadata.jupyterCodeCell) ? null : m) },
    { label: uiText.removeSystemMsg, reduce: (m) => (m.role === "system" ? null : m) },
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
