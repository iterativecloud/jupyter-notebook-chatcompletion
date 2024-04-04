import OpenAI from "openai";
import { ConfigurationTarget, window, workspace } from "vscode";
import { configKeys, msgs } from "./constants";

export async function getOpenAIApiKey(): Promise<string> {
  let apiKey = workspace.getConfiguration().get<string>(configKeys.openAiKey);
  if (!apiKey) {
    apiKey = await window.showInputBox({
      ignoreFocusOut: true,
      prompt: msgs.enterApiKey,
      validateInput: (value) => (value.trim().length > 0 ? null : msgs.apiKeyCannotBeEmpty),
    });

    if (apiKey) {
      await workspace.getConfiguration().update(configKeys.openAiKey, apiKey, ConfigurationTarget.Global);
    } else {
      window.showErrorMessage(msgs.apiKeyRequired, { modal: true });
      return "";
    }
  }

  return apiKey;
}

export function getTokenLimit(model: string): number | null {
  if (model.startsWith("gpt-4-32k")) {
    return 32768;
  }

  if (model.startsWith("gpt-4")) {
    return 8192;
  }

  if (model.startsWith("gpt-3.5-turbo-16k")) {
    return 16384;
  }

  if (model.startsWith("gpt-3.5")) {
    return 4096;
  }

  return null;
}

export type ExtendedCreateChatCompletionRequest = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
  [key: string]: any;
};

export function addParametersFromMetadata(nbMetadata: any, reqParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming) {
  const requestParams = ["top_p", "n", "max_tokens", "presence_penalty", "frequency_penalty", "logit_bias", "user"];

  const extendedReqParams: ExtendedCreateChatCompletionRequest = reqParams;

  for (const [metadataKey, reqParamKey] of Object.entries(requestParams)) {
    if (nbMetadata && nbMetadata[metadataKey]) {
      extendedReqParams[reqParamKey] = nbMetadata[metadataKey];
    }
  }

  return reqParams;
}
