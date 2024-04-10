import { l10n } from "vscode";

export class Constants {
  static noActiveNotebook = l10n.t("No active notebook found. Please open a notebook and try again.");
  static genNextCell = l10n.t("Generating next cell(s)...");
  static compCompleted = l10n.t("Cell generation completed");
  static compCancelled = l10n.t("Generation cancelled");
  static compFailed = l10n.t("Failed to generate new cell(s)");
  static apiViolation = l10n.t("OpenAI API finished early due to content policy violation");
  static logitValidJson = l10n.t("Logit Bias must be a valid JSON object");
  static apiKeyNotSet = l10n.t("OpenAI API key is not set");
  static enterApiKey = l10n.t("Enter your OpenAI API Key=");
  static apiKeyCannotBeEmpty = l10n.t("API Key cannot be empty");
  static apiKeyRequired = l10n.t("OpenAI API Key is required for Notebook ChatCompletion to work.");
  static connectionReset = l10n.t(
    "The OpenAI API closed the connection (ECONNRESET). You can incite the model to finish where it left off by adding a markdown cell with 'continue' and sending a new request."
  );
  static sendingRequest = l10n.t("Sending ChatCompletion request");
  static receivingTokens = l10n.t("Receiving tokens...");
  static notEnoughSavings = l10n.t("The selected strategies do not reduce tokens below the limit.");
  static calculatingTokeReductions = l10n.t("Token limit reached. Calculating potential reductions...");
  static calculatingTokens = l10n.t("Calculating tokens...");
  static modelNotSet = l10n.t("You must choose a valid model before proceeding.");
  static maxTokenLimit = l10n.t("The OpenAI API may return this error when the request goes over the max token limit");
  static apiKeyOrg = l10n.t("Ensure the correct OpenAI API key and requesting organization are being used.");
  static endpointModel = l10n.t("The OpenAI endpoint is not found or the requested model is unknown or not available to your account.");
  static rateLimit = l10n.t(
    "OpenAI Rate limit reached for requests, or you exceeded your current quota or the engine is currently overloaded."
  );
  static serverError = l10n.t("The OpenAI server had an error while processing your request.");
  static unhandledFinishReason = l10n.t("Invalid state= finish_reason wasn't handled.");
  static temperature = l10n.t("Temperature value (0-1)");
  static topP = l10n.t("Top P value (0-1)");
  static maxTokens = l10n.t("Max Tokens value (integer)");
  static presencePenalty = l10n.t("Presence Penalty value (0-1)");
  static frequencyPenalty = l10n.t("Frequency Penalty value (0-1)");
  static logitBias = l10n.t("Logit Bias value (JSON object)");
  static user = l10n.t("User value (string)");
  static selectModel = l10n.t("Select the model");
  static removeCodeCells = l10n.t("Remove all code problems");
  static removeOutput = l10n.t("Remove all code cell output");
  static removeProblems = l10n.t("Remove all code cell problems");
  static removeSystemMsg = l10n.t("Remove system message");
  static nCount = l10n.t("How many chat completion choices to generate for each input message");

  static configKeys = {
    openAiKey: "notebook-chatcompletion.openaiApiKey",
  };

  static messageMetadata = {
    jupyterCodeCell: "JupyterCodeCell",
    jupyterCodeCellProblems: "JupyterCodeCellProblems",
    jupyterCodeCellOutput: "JupyterCodeCellOutput",
  };
}
