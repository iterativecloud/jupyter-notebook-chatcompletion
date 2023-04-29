import axios from "axios";
import {
  ExtensionContext,
  ProgressLocation,
  commands,
  window,
  notebooks,
  Uri,
  SelectionRange,
  NotebookRange,
} from "vscode";
import { FinishReason } from "./finishReason";
import { generateCompletion } from "./completion";
import { CompletionType } from "./completionType";

const GENERATING_NEXT_CELL = "Generating next cell(s)...";
const COMPLETION_COMPLETED = "Cell generation completed";
const COMPLETION_CANCELLED = "Generation cancelled";
const COMPLETION_FAILED = "Failed to generate new cell(s)";

export async function activate(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(
      "notebook-chatcompletion.sendCellAndAbove", (...args) => 
      generateCells(args, CompletionType.currentCellAndAbove)
    )
  );

  context.subscriptions.push(
    commands.registerCommand("notebook-chatcompletion.sendCell", (...args) =>
      generateCells(args, CompletionType.currentCell)
    )
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function generateCells(args : any, completionType: CompletionType) {
  let cellIndex = args[0]?.index;

  if (!cellIndex) {
    cellIndex = window.activeNotebookEditor!.selection.end - 1;
  }

  window.activeNotebookEditor!.selection = new NotebookRange(cellIndex,cellIndex);

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
