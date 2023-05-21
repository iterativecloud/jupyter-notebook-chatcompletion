import { TiktokenModel, encoding_for_model } from "@dqbd/tiktoken";
import { ChatCompletionRequestMessage as Message, ChatCompletionResponseMessageRoleEnum as Role } from "openai";
import { QuickPickItem, window } from "vscode";
import { msgs, uiText } from "./constants";

export async function applyTokenReductions(
  messages: Message[],
  tokenOverflowCount: number,
  limit: number,
  model: TiktokenModel
): Promise<Message[] | null> {
  const replacements: { label: string; reduce: (arg1: Message) => Message | null }[] = [
    { label: uiText.removeOutput, reduce: (m) => (m.name === "Output" ? null : m) },
    { label: uiText.removeProblems, reduce: (m) => (m.name === "Problems" ? null : m) },
    { label: uiText.removeSystemMsg, reduce: (m) => (m.role === Role.System ? null : m) },
  ];

  type TokenReductionStrategy = QuickPickItem & {
    apply: Function;
    savedTokens?: number;
  };

  let strategies: TokenReductionStrategy[] = replacements.map((strategy) => ({
    label: strategy.label,
    apply: () => messages.map(strategy.reduce).filter((x) => x !== null),
  }));

  const totalTokenCount = countTotalTokens(messages, model);

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
    title: `You have ${tokenOverflowCount} more tokens than the model's limit of ${limit}`
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

export function countTokens(text: string, model: TiktokenModel): number {
  const enc = encoding_for_model(model);
  const tokenCount = enc.encode(text).length;
  enc.free();
  return tokenCount;
}

export function countTotalTokens(msgs: Message[], model: TiktokenModel): number {
  return msgs.reduce((accumulator, message) => {
    return accumulator + countTokens(message.content, model);
  }, 0);
}
