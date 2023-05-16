import axios from "axios";
import {
  ExtensionContext,
  NotebookEdit,
  NotebookRange,
  ProgressLocation,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import { generateCompletion } from "./completion";
import { CompletionType } from "./completionType";
import { FinishReason } from "./finishReason";
import { IncomingMessage } from "http";

const GENERATING_NEXT_CELL = "Generating next cell(s)...";
const COMPLETION_COMPLETED = "Cell generation completed";
const COMPLETION_CANCELLED = "Generation cancelled";
const COMPLETION_FAILED = "Failed to generate new cell(s)";

export async function activate(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.sendCellAndAbove",
      (...args) => generateCells(args, CompletionType.currentCellAndAbove)
    )
  );

  context.subscriptions.push(
    commands.registerCommand("notebook-chatcompletion.sendCell", (...args) =>
      generateCells(args, CompletionType.currentCell)
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.setRoleAssistant",
      setRoleAssistant
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.setRoleSystem",
      setRoleSystem
    )
  );

  context.subscriptions.push(
    commands.registerCommand("notebook-chatcompletion.setModel", setModel)
  );
  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.setTemperature",
      setTemperature
    )
  );

  context.subscriptions.push(
    commands.registerCommand("notebook-chatcompletion.setTopP", setTopP)
  );

  // n parameter is currently commented out because there's additional work
  // in determining it's behavior when combined with stream = true (as long as it's not clear, we don't support it)
  // context.subscriptions.push(
  //   commands.registerCommand("notebook-chatcompletion.setN", setN)
  // );

  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.setMaxTokens",
      setMaxTokens
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.setPresencePenalty",
      setPresencePenalty
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.setFrequencyPenalty",
      setFrequencyPenalty
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.setLogitBias",
      setLogitBias
    )
  );

  context.subscriptions.push(
    commands.registerCommand("notebook-chatcompletion.setUser", setUser)
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function generateCells(args: any, completionType: CompletionType) {
  let cellIndex = args[0]?.index;

  if (!cellIndex) {
    cellIndex = window.activeNotebookEditor!.selection.end - 1;
  }

  window.activeNotebookEditor!.selection = new NotebookRange(
    cellIndex,
    cellIndex
  );

  window.withProgress(
    {
      title: GENERATING_NEXT_CELL,
      location: ProgressLocation.Notification,
      cancellable: true,
    },
    async function (progress, token) {
      try {
        let finishReason = FinishReason.null;

        finishReason = await generateCompletion(
          cellIndex,
          completionType,
          progress,
          token,
          finishReason
        );

        // we are done editing any cell, so we close edit mode
        await commands.executeCommand("notebook.cell.quitEdit");

        switch (finishReason) {
          case FinishReason.length:
          case FinishReason.stop:
            // report success
            window.showInformationMessage(COMPLETION_COMPLETED);
            progress.report({ increment: 100 });
            break;

          case FinishReason.cancelled:
            // report cancellation
            window.showInformationMessage(COMPLETION_CANCELLED);
            progress.report({ increment: 100 });
            break;
          case FinishReason.contentFilter:
            // report content policy violation
            window.showErrorMessage(
              "OpenAI API finished early due to content policy violation"
            );
            progress.report({ increment: 100 });
            break;

          default:
            throw new Error("Invalid state: finish_reason wasn't handled.");
        }
      } catch (error: any) {
        if (error instanceof axios.Cancel) {
          window.showInformationMessage(
            `${COMPLETION_CANCELLED}: ${error.message}`
          );
          return;
        }

        let detail = "";

        if (!error.response) {
          detail = getErrorMessage(error);
        } else {
          switch (error.response.status) {
            case 400:
              detail =
                "The OpenAI API may return this error when the request goes over the max token limit\n";
              break;
            case 401:
              detail =
                "Ensure the correct OpenAI API key and requesting organization are being used.\n";
              break;
            case 404:
              detail =
                "The OpenAI endpoint is not found or the requested model is unknown or not available to your account.\n";
              break;
            case 429:
              detail =
                "OpenAI Rate limit reached for requests, or you exceeded your current quota or the engine is currently overloaded.\n";
              break;
            case 500:
              detail =
                "The OpenAI server had an error while processing your request.\n";
              break;
          }
        }

        detail += getErrorMessage(error);

        window.showErrorMessage(`${COMPLETION_FAILED}: ${error.message}`, {
          detail,
          modal: true,
        });
      }
    }
  );
}

async function setTopP() {
  const editor = window.activeNotebookEditor!;
  const topP = await window.showInputBox({
    prompt: "Enter the Top P value (0-1):",
    validateInput: (value) =>
      parseFloat(value) >= 0 && parseFloat(value) <= 1
        ? null
        : "Top P must be between 0 and 1",
  });

  if (topP) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          top_p: parseFloat(topP),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setModel() {
  const editor = window.activeNotebookEditor!;
  let model = await window.showQuickPick(
    [
      "gpt-4",
      "gpt-4-0314",
      "gpt-4-32k",
      "gpt-4-32k-0314",
      "gpt-3.5-turbo",
      "gpt-3.5-turbo-0301",
      "other",
    ],
    {
      placeHolder: "Select the model:",
    }
  );

  if (model === "other") {
    model = await window.showInputBox({
      prompt: "Enter the model name:",
      validateInput: (value) =>
        value.trim().length > 0 ? null : "Model name cannot be empty",
    });
  }

  if (model) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: { ...editor.notebook.metadata.custom, model: model },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

export async function setTemperature() {
  const editor = window.activeNotebookEditor!;
  const temperature = await window.showInputBox({
    prompt: "Enter the temperature value (0-1):",
    validateInput: (value) =>
      parseFloat(value) >= 0 && parseFloat(value) <= 1
        ? null
        : "Temperature must be between 0 and 1",
  });

  if (temperature) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          temperature: parseFloat(temperature),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setRoleAssistant() {
  const editor = window.activeNotebookEditor!;
  const cellIndex = editor.selection.end - 1;
  const cell = editor.notebook.cellAt(cellIndex);

  const edit = new WorkspaceEdit();
  edit.set(cell.notebook.uri, [
    NotebookEdit.updateCellMetadata(cell.index, {
      custom: { metadata: { tags: ["assistant"] } },
    }),
  ]);
  await workspace.applyEdit(edit);
}

async function setRoleSystem() {
  const editor = window.activeNotebookEditor!;
  const cellIndex = editor.selection.end - 1;
  const cell = editor.notebook.cellAt(cellIndex);

  const edit = new WorkspaceEdit();
  edit.set(cell.notebook.uri, [
    NotebookEdit.updateCellMetadata(cell.index, {
      custom: { metadata: { tags: ["system"] } },
    }),
  ]);
  await workspace.applyEdit(edit);
}

async function setN() {
  const editor = window.activeNotebookEditor!;
  const n = await window.showInputBox({
    prompt: "Enter the N value (integer):",
    validateInput: (value) =>
      parseInt(value) > 0 ? null : "N must be a positive integer",
  });

  if (n) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          n: parseInt(n),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setMaxTokens() {
  const editor = window.activeNotebookEditor!;
  const maxTokens = await window.showInputBox({
    prompt: "Enter the Max Tokens value (integer):",
    validateInput: (value) =>
      parseInt(value) > 0 ? null : "Max Tokens must be a positive integer",
  });

  if (maxTokens) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          max_tokens: parseInt(maxTokens),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setPresencePenalty() {
  const editor = window.activeNotebookEditor!;
  const presencePenalty = await window.showInputBox({
    prompt: "Enter the Presence Penalty value (0-1):",
    validateInput: (value) =>
      parseFloat(value) >= 0 && parseFloat(value) <= 1
        ? null
        : "Presence Penalty must be between 0 and 1",
  });

  if (presencePenalty) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          presence_penalty: parseFloat(presencePenalty),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setFrequencyPenalty() {
  const editor = window.activeNotebookEditor!;
  const frequencyPenalty = await window.showInputBox({
    prompt: "Enter the Frequency Penalty value (0-1):",
    validateInput: (value) =>
      parseFloat(value) >= 0 && parseFloat(value) <= 1
        ? null
        : "Frequency Penalty must be between 0 and 1",
  });

  if (frequencyPenalty) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          frequency_penalty: parseFloat(frequencyPenalty),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setLogitBias() {
  const editor = window.activeNotebookEditor!;
  const logitBias = await window.showInputBox({
    prompt: "Enter the Logit Bias value (JSON object):",
    validateInput: (value) => {
      try {
        JSON.parse(value);
        return null;
      } catch (error) {
        return "Logit Bias must be a valid JSON object";
      }
    },
  });

  if (logitBias) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          logit_bias: JSON.parse(logitBias),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setUser() {
  const editor = window.activeNotebookEditor!;
  const user = await window.showInputBox({
    prompt: "Enter the User value (string):",
    validateInput: (value) =>
      value.trim().length > 0 ? null : "User value cannot be empty",
  });

  if (user) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          user: user,
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}
