import { CreateChatCompletionRequest } from "openai";
import { ConfigurationTarget, window, workspace } from "vscode";
import { configKeys, msgs } from "./constants";

export async function getOpenAIApiKey(): Promise<string> {
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

export function getTokenLimit(model: string): number | null {
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

  return limit;
}

export type ExtendedCreateChatCompletionRequest = CreateChatCompletionRequest & {
  [key: string]: any;
};

export function addParametersFromMetadata(nbMetadata: any, reqParams: CreateChatCompletionRequest) {
  const requestParams = ["top_p", "n", "max_tokens", "presence_penalty", "frequency_penalty", "logit_bias", "user"];

  const extendedReqParams: ExtendedCreateChatCompletionRequest = reqParams;

  for (const [metadataKey, reqParamKey] of Object.entries(requestParams)) {
    if (nbMetadata && nbMetadata[metadataKey]) {
      extendedReqParams[reqParamKey] = nbMetadata[metadataKey];
    }
  }

  return reqParams;
}
