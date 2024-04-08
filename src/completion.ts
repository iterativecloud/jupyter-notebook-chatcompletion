import { TiktokenModel } from "@dqbd/tiktoken";
import { ChatCompletionChunk } from "openai/resources";
import { Stream } from "openai/streaming";
import {
  CancellationToken,
  NotebookCellKind,
  NotebookEdit,
  NotebookRange,
  TextEditorCursorStyle,
  WorkspaceEdit,
  window,
  workspace,
} from "vscode";
import { appendTextToCell, insertCell } from "./utilities/cellUtils";
import { msgs } from "./constants";
import { FinishReason } from "./finishReason";
import { bufferWholeChunks, streamChatCompletion } from "./utilities/streamUtils";
import { UIProgress } from "./uiProgress";

export const output = window.createOutputChannel("Notebook ChatCompletion", "json");

export async function streamResponse(
  responseStream: Stream<ChatCompletionChunk>,
  cancelToken: CancellationToken,
  cellIndex: number,
  ck: NotebookCellKind | undefined,
  progress: UIProgress
): Promise<FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[]> {
  const editor = window.activeNotebookEditor!;
  output.show(true);

  let hasPrintedNotebookWriteBanner = false;
  for await (let textTokenOrFinishReason of bufferWholeChunks(streamChatCompletion(responseStream, cancelToken))) {
    // When ToolCall[] is returned
    if (Array.isArray(textTokenOrFinishReason)) {
      output.appendLine("___Tool calls_________________________________");
      output.appendLine(JSON.stringify(textTokenOrFinishReason, null, 2));
      return textTokenOrFinishReason;
    }

    if (Object.values(FinishReason).includes(textTokenOrFinishReason as FinishReason)) {
      const currentCell = window.activeNotebookEditor!.notebook.cellAt(cellIndex);
      const text = currentCell.document.getText();

      if (!/\S/.test(text)) {
        const edit = new WorkspaceEdit();
        edit.set(currentCell.notebook.uri, [NotebookEdit.deleteCells(new NotebookRange(currentCell.index, currentCell.index + 1))]);
        await workspace.applyEdit(edit);
      }

      return textTokenOrFinishReason as FinishReason;
    } else {
      if (!hasPrintedNotebookWriteBanner) {
        output.appendLine("___Writes to Notebook_________________________");
        hasPrintedNotebookWriteBanner = true;
      }
      output.append(textTokenOrFinishReason.toString());
    }

    if (typeof textTokenOrFinishReason !== "string") {
      throw new Error(`Unknown stream result: ${textTokenOrFinishReason}`);
    }

    if (textTokenOrFinishReason.includes("```python\n")) {
      ck = NotebookCellKind.Code;

      cellIndex = await insertCell(editor, cellIndex, ck, "python");
      textTokenOrFinishReason = textTokenOrFinishReason.replace("```python\n", "");
    } else if (textTokenOrFinishReason.includes("```") && ck === NotebookCellKind.Code) {
      textTokenOrFinishReason = textTokenOrFinishReason.replace("```", "");

      ck = NotebookCellKind.Markup;
      cellIndex = await insertCell(editor, cellIndex, ck);
    }

    if (ck === undefined) {
      cellIndex = await insertCell(editor, cellIndex, NotebookCellKind.Markup);
      ck = NotebookCellKind.Markup;
    }

    await appendTextToCell(editor, cellIndex, textTokenOrFinishReason);

    progress.report({ increment: 0.5, message: msgs.receivingTokens });
  }

  return FinishReason.length;
}

export function getValidAlternativeIfAvailable(model: string): TiktokenModel {
  // For new models we know exists but are not known by Tiktoken, we choose a suitable alternative
  switch (model) {
    case "gpt-3.5-turbo-16k-0613":
    case "gpt-3.5-turbo-0613":
    case "gpt-3.5-turbo-16k":
      return "gpt-3.5-turbo";

    case "gpt-4-0613":
    case "gpt-4-32k-0613":
      return "gpt-4";

    default:
      return model as TiktokenModel;
  }
}
