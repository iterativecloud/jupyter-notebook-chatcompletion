import axios from "axios";
import { Configuration, OpenAIApi } from "openai";
import { CancellationToken, NotebookCellKind, window } from "vscode";
import { UIProgress } from "./uiProgress";
import {
  appendTextToCell,
  insertCell,
  convertCellsToMessages,
} from "./cellUtils";
import { FinishReason } from "./finishReason";
import { streamChatCompletion, bufferWholeChunks } from "./streamUtils";

export const SENDING_COMPLETION_REQUEST = "Sending ChatCompletion request";
export const RECEIVING_TOKENS = "Receiving tokens...";
const pythonCodeBlockStart = "```python\n";
const codeBlockEnd = "```\n";

export const output = window.createOutputChannel("Notebook ChatCompletion");

export async function generateCompletion(
  progress: UIProgress,
  token: CancellationToken,
  previousFinishReason: FinishReason
): Promise<FinishReason> {
  const editor = window.activeNotebookEditor!;

  const messages = await convertCellsToMessages();
  let cellIndex = editor.selection.end - 1;
  let currentKind: NotebookCellKind | undefined = undefined;

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
    output.append(textToken.toString());

    if (Object.values(FinishReason).includes(textToken as FinishReason)) {
      return textToken as FinishReason;
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
      // a code block end where we transition to a markdown cell
      // only really makes sense when we already had a code cell
      // We assume a  code block end, followed by a new markdown cell
      currentKind = NotebookCellKind.Markup;
      cellIndex = await insertCell(editor, cellIndex, currentKind, "markdown");
      textToken = textToken.replace(codeBlockEnd, "");
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
