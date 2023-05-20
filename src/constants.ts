export const msgs = {
  genNextCell: "Generating next cell(s)...",
  compCompleted: "Cell generation completed",
  compCancelled: "Generation cancelled",
  compFailed: "Failed to generate new cell(s)",
  apiViolation: "OpenAI API finished early due to content policy violation",
  logitValidJson: "Logit Bias must be a valid JSON object"
};

export const prompts = {
  temperature: "Temperature value (0-1):",
  topP: "Top P value (0-1):",
  maxTokens: "Max Tokens value (integer):",
  presencePenalty: "Presence Penalty value (0-1):",
  frequencyPenalty: "Frequency Penalty value (0-1):",
  logitBias: "Logit Bias value (JSON object):",
  user: "User value (string):",
  selectModel: "Select the model:",
};

export const models = ["gpt-4", "gpt-4-0314", "gpt-4-32k", "gpt-4-32k-0314", "gpt-3.5-turbo", "gpt-3.5-turbo-0301", "other"];

export const errorMessages = {
  maxTokenLimit: "The OpenAI API may return this error when the request goes over the max token limit",
  apiKeyOrg: "Ensure the correct OpenAI API key and requesting organization are being used.",
  endpointModel: "The OpenAI endpoint is not found or the requested model is unknown or not available to your account.",
  rateLimit: "OpenAI Rate limit reached for requests, or you exceeded your current quota or the engine is currently overloaded.",
  serverError: "The OpenAI server had an error while processing your request.",
  unhandledFinishReason: "Invalid state: finish_reason wasn't handled.",
};
