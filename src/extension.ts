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

        while (
          finishReason === FinishReason.null ||
          finishReason === FinishReason.length
        ) {
          finishReason = await generateCompletion(
            cellIndex,
            completionType,
            progress,
            token,
            finishReason
          );
        }

        // we are done editing any cell, so we close edit mode
        await commands.executeCommand("notebook.cell.quitEdit");

        switch (finishReason) {
          case FinishReason.stop:
            // report success
            window.showInformationMessage(COMPLETION_COMPLETED);
            progress.report({ increment: 100 });
            break;

          case FinishReason.contentFilter:
            // report content policy violation
            window.showErrorMessage(
              "API finished early due to content policy violation"
            );
            progress.report({ increment: 100 });
            break;

          default:
            throw new Error("Invalid state: finish_reason wasn't handled.");
        }
      } catch (error: any) {
        if (error instanceof axios.Cancel) {
          // report cancellation
          window.showInformationMessage(
            `${COMPLETION_CANCELLED}: ${error.message}`
          );
        } else {
          // report error
          window.showErrorMessage(`${COMPLETION_FAILED}: ${error.message}`, {
            detail: getErrorMessage(error),
            modal: true,
          });
        }
      }
    }
  );
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
