import axios from "axios";
import { Configuration, OpenAIApi } from "openai";
import {
  CancellationToken,
  NotebookCellKind,
  NotebookEdit,
  NotebookRange,
  WorkspaceEdit,
  window,
  workspace,
} from "vscode";
import {
  appendTextToCell,
  convertCellsToMessages,
  insertCell,
} from "./cellUtils";
import { CompletionType } from "./completionType";
import { FinishReason } from "./finishReason";
import { bufferWholeChunks, streamChatCompletion } from "./streamUtils";
import { UIProgress } from "./uiProgress";

export const SENDING_COMPLETION_REQUEST = "Sending ChatCompletion request";
export const RECEIVING_TOKENS = "Receiving tokens...";
const pythonCodeBlockStart = "```python\n";
const codeBlockEnd = "```";

export const output = window.createOutputChannel("Notebook ChatCompletion");

export async function generateCompletion(
  cellIndex: number,
  completionType: CompletionType,
  progress: UIProgress,
  token: CancellationToken,
  previousFinishReason: FinishReason
): Promise<FinishReason> {
  const editor = window.activeNotebookEditor!;

  const messages = await convertCellsToMessages(cellIndex, completionType);
  let currentKind: NotebookCellKind | undefined = undefined;

  // If the generation was previously interrupted, we need to nudge the prompt
  // toward continuation without repetition of incomplete text.
  if (previousFinishReason === FinishReason.length) {
    // If we see that we previously finished because of length, we assume that the current call is
    // a continuation of an interrupted completion (max token length), and therefore we
    // will not create a new cell and append text to the existing one instead
    let cell = editor.notebook.cellAt(cellIndex);
    currentKind = cell.kind;

    // This is a workaround because normally we persist the role as cell metadata.
    // However, we cannot read directly the metadata directly after write until the cell is out
    // of edit mode, so we have to manually fix the role of the last cell in order to continue directly.
    const userMessages = messages.filter((m) => m.role === "user");
    userMessages[userMessages.length - 1].role = "assistant";

    // we inject an extra message to force continuation without repetition
    messages.push({
      role: "user",
      content: "Continue. Don't repeat any text from your previous message.",
    });
  }

  const openai = new OpenAIApi(
    new Configuration({ apiKey: process.env.OI_API_KEY })
  );

  const tokenSource = axios.CancelToken.source();
  token.onCancellationRequested(() => tokenSource.cancel());
  output.appendLine("\n" + JSON.stringify(messages, undefined, 2) + "\n");
  progress.report({ increment: 1, message: SENDING_COMPLETION_REQUEST });

  const response = await openai.createChatCompletion(
    {
      model: "gpt-4",
      messages,
      stream: true,
      temperature: 0,
    },
    { cancelToken: tokenSource.token, responseType: "stream" }
  );

  for await (let textToken of bufferWholeChunks(
    streamChatCompletion(response, token)
  )) {
    // debug output of FinishReaseon
    if (Object.values(FinishReason).includes(textToken as FinishReason)) {
      switch (textToken) {
        case FinishReason.length:
          output.append("FINISH_REASON_LENGTH" + "\n");
          break;
        case FinishReason.contentFilter:
          output.append("FINISH_REASON_CONTENTFILTER" + "\n");
          break;
        case FinishReason.stop:
          output.append("FINISH_REASON_STOP" + "\n");
          break;
      }

      const currentCell = editor.notebook.cellAt(cellIndex);
      const text = currentCell.document.getText();

      // we're wrapping up and may find out that the last cell only contains whitespaces or linesbreak.
      // in that case, we retroactively removed that last empty cell
      if (!/\S/.test(text)) {
        const edit = new WorkspaceEdit();
        edit.set(currentCell.notebook.uri, [
          NotebookEdit.deleteCells(
            new NotebookRange(currentCell.index, currentCell.index + 1)
          ),
        ]);
        await workspace.applyEdit(edit);
      }

      return textToken as FinishReason;
    } else {
      // Debug output of text
      output.append(textToken.toString());
    }

    if (typeof textToken !== "string") {
      throw new Error("Invalid state: unknown stream result: " + textToken);
    }

    if (textToken.includes(pythonCodeBlockStart)) {
      // we have yet to support polyglot notebooks, so for now we treat everything that isn't
      // python as markdown. Still, we make a dedicated cell for that block.
      currentKind = NotebookCellKind.Code;

      cellIndex = await insertCell(editor, cellIndex, currentKind, "python");
      textToken = textToken.replace(pythonCodeBlockStart, "");
    } else if (
      textToken.includes(codeBlockEnd) &&
      currentKind === NotebookCellKind.Code
    ) {
      textToken = textToken.replace(codeBlockEnd, "");

      // if after removing the backticks we still got some remaining that isn't linebreaks or whitespaces,
      // we create a new markdown cell
      currentKind = NotebookCellKind.Markup;
      cellIndex = await insertCell(editor, cellIndex, currentKind, "markdown");
    }

    if (currentKind === undefined) {
      // we assume we are just getting started with a first markdown cell
      cellIndex = await insertCell(
        editor,
        cellIndex,
        NotebookCellKind.Markup,
        "markdown"
      );
      currentKind = NotebookCellKind.Markup;
    }

    // write token
    await appendTextToCell(editor, cellIndex, textToken);

    progress.report({ increment: 0.5, message: RECEIVING_TOKENS });
  }

  // We came to the end of the string without ever receiving a FinishReason from the API (or we have a bug). This is an invalid state.
  throw new Error("Reached end of stream before receiving stop_reason");
}
