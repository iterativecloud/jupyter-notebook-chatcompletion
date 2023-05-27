export const msgs = {
  genNextCell: "Generating next cell(s)...",
  compCompleted: "Cell generation completed",
  compCancelled: "Generation cancelled",
  compFailed: "Failed to generate new cell(s)",
  apiViolation: "OpenAI API finished early due to content policy violation",
  logitValidJson: "Logit Bias must be a valid JSON object",
  apiKeyNotSet: "OpenAI API key is not set",
  enterApiKey: "Enter your OpenAI API Key:",
  apiKeyCannotBeEmpty: "API Key cannot be empty",
  apiKeyRequired: "OpenAI API Key is required for Notebook ChatCompletion to work.",
  connectionReset:
    "The OpenAI API closed the connection (ECONNRESET). You can incite the model to finish where it left off by adding a markdown cell with 'continue' and sending a new request.",
  sendingRequest: "Sending ChatCompletion request",
  receivingTokens: "Receiving tokens...",
  notEnoughSavings: "The selected strategies do not reduce tokens below the limit.",
  calculatingTokeReductions: "Token limit reached. Calculating potential reductions...",
  calculatingTokens: "Calculating tokens...",
  modelNotSet: "You must choose a valid model before proceeding."
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

export const errorMessages = {
  maxTokenLimit: "The OpenAI API may return this error when the request goes over the max token limit",
  apiKeyOrg: "Ensure the correct OpenAI API key and requesting organization are being used.",
  endpointModel: "The OpenAI endpoint is not found or the requested model is unknown or not available to your account.",
  rateLimit: "OpenAI Rate limit reached for requests, or you exceeded your current quota or the engine is currently overloaded.",
  serverError: "The OpenAI server had an error while processing your request.",
  unhandledFinishReason: "Invalid state: finish_reason wasn't handled.",
};

export const configKeys = {
  openAiKey: "notebook-chatcompletion.openaiApiKey",
};

export const uiText = {
    removeOutput : "Remove all Cell Output",
    removeProblems: "Remove all VSCode Problems",
    removeSystemMsg: "Remove System Message",
    tabifyWhiteSpaces: "Tabify whitespaces"
};