import axios from "axios";
import { ExtensionContext, ProgressLocation, commands, window } from "vscode";
import { FinishReason } from "./finishReason";
import { generateCompletion } from "./completion";

const NOTEBOOK_OR_SELECTION_NOT_FOUND =
  "Couldn't find active notebook or selected notebook cells.";
const GENERATING_NEXT_CELL = "Generating next cell via ChatCompletion API...";
const COMPLETION_COMPLETED = "ChatCompletion complete";
const COMPLETION_CANCELLED = "ChatCompletion API request cancelled";
const COMPLETION_FAILED = "Failed to generate new cell via ChatCompletion API";

export async function activate(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.generateNewCodeCell",
      async () => {
        const editor = window.activeNotebookEditor;
        if (!editor?.notebook || !editor?.selection) {
          return window.showErrorMessage(NOTEBOOK_OR_SELECTION_NOT_FOUND);
        }

        window.withProgress(
          {
            title: GENERATING_NEXT_CELL,
            location: ProgressLocation.Notification,
            cancellable: true,
          },
          async (progress, token) => {
            try {
              let finishReason = FinishReason.null;

              while (
                finishReason === FinishReason.null ||
                finishReason === FinishReason.length
              ) {
                finishReason = await generateCompletion(
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
                  throw new Error(
                    "Invalid state: finish_reason wasn't handled."
                  );
              }
            } catch (error: any) {
              if (error instanceof axios.Cancel) {
                // report cancellation
                window.showInformationMessage(
                  `${COMPLETION_CANCELLED}: ${error.message}`
                );
              } else {
                // report error
                window.showErrorMessage(
                  `${COMPLETION_FAILED}: ${error.message}`,
                  { detail: getErrorMessage(error), modal: true }
                );
              }
            }
          }
        );
      }
    )
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
