import axios from "axios";
import { Configuration, OpenAIApi } from "openai";
import {
  CancellationToken,
  ExtensionContext,
  NotebookCellKind,
  ProgressLocation,
  commands,
  window,
} from "vscode";
import { UIProgress } from "./uiProgress";
import {
  appendTextToCell,
  insertCell,
  convertCellsToMessages,
} from "./cellUtils";
import { FinishReason } from "./finishReason";
import { streamChatCompletion } from "./streamUtils";

const NOTEBOOK_OR_SELECTION_NOT_FOUND =
  "Couldn't find active notebook or selected notebook cells.";
const GENERATING_NEXT_CELL_MESSAGE =
  "Generating next cell via ChatCompletion API...";
const COMPLETION_COMPLETED_MESSAGE = "ChatCompletion complete";
const COMPLETION_CANCELLED_MESSAGE = "ChatCompletion API request cancelled";
const COMPLETION_FAILED_MESSAGE =
  "Failed to generate new cell via ChatCompletion API";

const SENDING_COMPLETION_REQUEST = "Sending ChatCompletion request";
const STARTING_CODEBLOCK = "Starting new code block";
const RECEIVING_TOKENS = "Receiving tokens...";
const CODEBLOCK_START_MAXLENGTH = 20;
const CODEBLOCK_START_REGEX = /\n?```(\w+).*\n?/;
const CODEBLOCK_END_REGEX = /\n*```(?!\w).*\n?/;

export const output = window.createOutputChannel("Notebook ChatCompletion");

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
            title: GENERATING_NEXT_CELL_MESSAGE,
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
                  window.showInformationMessage(COMPLETION_COMPLETED_MESSAGE);
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
                  `${COMPLETION_CANCELLED_MESSAGE}: ${error.message}`
                );
              } else {
                // report error
                window.showErrorMessage(
                  `${COMPLETION_FAILED_MESSAGE}: ${error.message}`,
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

async function generateCompletion(
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

  let linebuffer: string = "";
  for await (const textToken of streamChatCompletion(response, token)) {
    if (Object.values(FinishReason).includes(textToken as FinishReason)) {
      return textToken as FinishReason;
    }

    if (typeof textToken !== "string") {
      throw new Error("Invalid state: unknown stream result: " + textToken);
    }

    output.append(textToken);

    linebuffer += textToken;

    if (
      linebuffer.startsWith("`") &&
      linebuffer.length <= CODEBLOCK_START_MAXLENGTH
    ) {
      // there might be more backticks if the line starts with one,
      // so we keep going until we reached the length of an hypothetical code block start
      continue;
    }

    const codeBlockStartMatch = CODEBLOCK_START_REGEX.exec(linebuffer);

    if (previousFinishReason !== FinishReason.length) {
      if (codeBlockStartMatch) {
        // we have yet to support polyglot notebooks, so for now we treat everything that isn't
        // python as markdown. Still, we make a dedicated cell for that block.
        const language = codeBlockStartMatch[1];
        currentKind =
          language === "python"
            ? NotebookCellKind.Code
            : NotebookCellKind.Markup;

        cellIndex = await insertCell(editor, cellIndex, currentKind, language);
        linebuffer = linebuffer.replace(CODEBLOCK_START_REGEX, "");

      } else if (CODEBLOCK_END_REGEX.test(linebuffer)) {
        if (currentKind) {
          if (currentKind === NotebookCellKind.Code) {
            // normal code block end, followed by a new markdown cell
            cellIndex = await insertCell(
              editor,
              cellIndex,
              NotebookCellKind.Markup,
              "markdown"
            );
            currentKind = NotebookCellKind.Markup;
            linebuffer = linebuffer.replace(CODEBLOCK_END_REGEX, "");
          }
        } else {
          // we assume we are just getting started with a first markdown cell
          cellIndex = await insertCell(
            editor,
            cellIndex,
            NotebookCellKind.Markup,
            "markdown"
          );
          currentKind = NotebookCellKind.Markup;
          linebuffer = linebuffer.replace(CODEBLOCK_END_REGEX, "");
        }
      } else if (currentKind === undefined) {
        // we assume we are just getting started with a first markdown cell
        cellIndex = await insertCell(
          editor,
          cellIndex,
          NotebookCellKind.Markup,
          "markdown"
        );
        currentKind = NotebookCellKind.Markup;
      }
    } 

    // write token
    await appendTextToCell(editor, cellIndex, textToken);

    // remove written token from buffer
    linebuffer = linebuffer.substring(textToken.length - 1);

    progress.report({ increment: 0.5, message: RECEIVING_TOKENS });
  }

  // We came to the end of the string without ever receiving a FinishReason from the API (or we have a bug). This is an invalid state.
  throw new Error("Reached end of stream before receiving stop_reason");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
