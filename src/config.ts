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
  switch (model) {
    case 'gpt-3.5-turbo':
    case 'gpt-3.5-turbo-0125':
    case 'gpt-3.5-turbo-1106':
    case 'gpt-3.5-turbo-instruct':
    case 'gpt-3.5-turbo-0613':
    case 'gpt-4-0125-preview':
    case 'gpt-4-turbo-preview':
    case 'gpt-4-1106-preview':
    case 'gpt-4-vision-preview':
    case 'gpt-4-1106-vision-preview':
      return 4096;
    case 'gpt-3.5-turbo-16k':
    case 'gpt-3.5-turbo-16k-0613':
      return 16385;
    case 'gpt-4-32k':
    case 'gpt-4-32k-0613':
      return 32768;
    case 'gpt-4':
    case 'gpt-4-0613':
      return 8192;
    default:
      // if we don't know the model, we return null to signal no applicable limit
      return null;
  }
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
