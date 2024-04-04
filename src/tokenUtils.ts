import { TiktokenModel, encoding_for_model } from "@dqbd/tiktoken";
import { QuickPickItem, window } from "vscode";
import { ChatCompletionMessageParamEx } from "./chatCompletionMessageParamEx";
import { uiText } from "./constants";

function tabifyWhitespaces(message: ChatCompletionMessageParamEx): ChatCompletionMessageParamEx {
  if(message.content instanceof String )
  {
    message.content = message.content!.replace(/ {4}/g, "\t");
  }
  return message;
}

export async function applyTokenReductions(
  messages: ChatCompletionMessageParamEx[],
  tokenOverflowCount: number,
  limit: number,
  model: TiktokenModel
): Promise<ChatCompletionMessageParamEx[] | null> {
  const replacements: { label: string; reduce: (arg1: ChatCompletionMessageParamEx) => ChatCompletionMessageParamEx | null }[] = [
    { label: uiText.removeOutput, reduce: (m) => (m.name === "Output" ? null : m) },
    { label: uiText.removeProblems, reduce: (m) => (m.name === "Problems" ? null : m) },
    { label: uiText.removeSystemMsg, reduce: (m) => (m.role === "system" ? null : m) },
    { label: uiText.tabifyWhiteSpaces, reduce: tabifyWhitespaces },
  ];

  type TokenReductionStrategy = QuickPickItem & {
    apply: Function;
    savedTokens?: number;
  };

  let strategies: TokenReductionStrategy[] = replacements.map((strategy) => ({
    label: strategy.label,
    apply: () => messages.map(strategy.reduce).filter((x) => x !== null),
  }));

  const totalTokenCount = countTokens(messages, model);

  for (const strategy of strategies) {
    const reducedMessages = await strategy.apply();
    const reducedTokenCount = countTokens(reducedMessages, model);
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

export function countTokens(messages: any[], model: TiktokenModel): number {
  const encoding = encoding_for_model(model);
  let tokensPerMessage = 4;
  let tokensPerName = 1;

  let numTokens = 0;
  for (const message of messages) {
    numTokens += tokensPerMessage;
    for (const key in message) {
      const value = message[key];
      numTokens += encoding.encode(value).length;
      if (key === "name") {
        numTokens += tokensPerName;
      }
    }
  }
  numTokens += 3;
  return numTokens;
}
