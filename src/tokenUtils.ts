import { encoding_for_model } from "@dqbd/tiktoken";
import { ChatCompletionRequestMessage } from "openai";
import { QuickPickItem, window } from "vscode";
import { msgs, uiText } from "./constants";

export async function applyTokenReductions(
  messages: ChatCompletionRequestMessage[],
  tokenOverflowCount: number,
  totalTokenCount: number,
  limit: number,
  model: string
): Promise<ChatCompletionRequestMessage[] | null> {
  const replacements = [
    [uiText.removeOutput, /^Output from previous code:.*\n?/gm, () => ""],
    [uiText.removeProblems, /^Problems reported by VSCode from previous code:.*\n?/gm, () => ""],
    [uiText.removeSpaces, / /g, () => ""],
    [uiText.removeLineBreaks, /\n/g, () => ""],
    [uiText.removePunctuation, /[.,;:!?]/g, () => ""],
  ];

  type TokenReductionStrategy = QuickPickItem & {
    apply: Function;
    savedTokens?: number;
  };

  let strategies: TokenReductionStrategy[] = replacements.map(([label, pattern, replacementFn]) => ({
    label: label as string,
    apply: async () => {
      return messages.map((message) => ({
        ...message,
        content: message.content.replace(pattern as RegExp, replacementFn as () => string),
      }));
    },
  }));

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

export function countTokens(text: string, model: any): number {
  const enc = encoding_for_model(model);
  const tokenCount = enc.encode(text).length;
  enc.free();
  return tokenCount;
}

export function countTotalTokens(msgs: ChatCompletionRequestMessage[], model: string): number {
  return msgs.reduce((accumulator, message) => {
    return accumulator + countTokens(message.content, model);
  }, 0);
}
