import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  NotebookCellKind,
  NotebookEdit,
  NotebookEditor,
  NotebookRange,
  Range,
  WorkspaceEdit,
  commands,
  languages,
  window,
  workspace,
} from "vscode";
import { ChatCompletionRole } from "../models/ChatCompletionRole";
import { CompletionType } from "../models/completionType";
import { Constants } from "../Constants";
import { ToolCallExecutionResult } from "../models/ToolCallExecutionResult";

export async function appendTextToCell(editor: NotebookEditor, cellIndex: number, textToken: string) {
  const existingCell = editor.notebook.cellAt(cellIndex);

  // If the cell is empty, it doesn't make sense to add any superfluous linebreaks, tabs or whitespaces
  if (existingCell.document.getText().length === 0 && !/\S/.test(textToken)) {
    return;
  }

  if (textToken.startsWith("\n")) {
    // we check if this is an empty cell. In that case, it doesn't make sense to start with a line break
    if (existingCell.document.positionAt(1).character === 0) {
      // we might have received a little more than just a linebreak, so we keep the remaining text and this function continue. Otherwise, we skip completly.
      if (textToken.length > 1) {
        textToken = textToken.substring(1);
      } else {
        return;
      }
    }
  }

  const edit = new WorkspaceEdit();
  edit.insert(existingCell.document.uri, existingCell.document.positionAt(9999999999), textToken);
  await workspace.applyEdit(edit);
}

export async function insertCell(editor: NotebookEditor, cellIndex: number, cellKind: NotebookCellKind, languageId: string = "markdown") {
  // Whenever we insert a cell, we remove any superfluous linebreaks in the previous cell
  const existingCell = editor.notebook.cellAt(cellIndex);
  if (existingCell.document.getText().endsWith("\n")) {
    const edit = new WorkspaceEdit();
    const lastLineRange = existingCell.document.validateRange(
      new Range(existingCell.document.lineCount - 2, 9999999999, existingCell.document.lineCount, 0)
    );

    edit.delete(existingCell.document.uri, lastLineRange);
    await workspace.applyEdit(edit);
  }

  await commands.executeCommand("notebook.cell.quitEdit");

  if (cellKind === NotebookCellKind.Code && languageId === "python") {
    await commands.executeCommand("notebook.cell.insertCodeCellBelow", [{ index: cellIndex }]);
  } else {
    await commands.executeCommand("notebook.cell.insertMarkdownCellBelow", [{ index: cellIndex }]);
  }

  cellIndex++;

  const edit = new WorkspaceEdit();
  let cell = editor.notebook.cellAt(cellIndex);
  edit.set(cell.notebook.uri, [
    NotebookEdit.updateCellMetadata(cell.index, {
      custom: { metadata: { tags: ["assistant"] } },
    }),
  ]);
  await workspace.applyEdit(edit);

  return cellIndex;
}

export async function updateToolResultsCellMetadata(editor: NotebookEditor, cellIndex: number, toolResults: ToolCallExecutionResult[]) {
  const edit = new WorkspaceEdit();
  let cell = editor.notebook.cellAt(cellIndex);
  const updatedCellMetadata = cell.metadata.custom.metadata;
  updatedCellMetadata.toolResults = toolResults;
  edit.set(cell.notebook.uri, [NotebookEdit.updateCellMetadata(cell.index, updatedCellMetadata)]);
  await workspace.applyEdit(edit);

  return cellIndex;
}

export async function convertCellsToMessages(cellIndex: number, completionType: CompletionType): Promise<ChatCompletionMessageParam[]> {
  const editor = window.activeNotebookEditor!;
  const notebook = editor.notebook;

  const startCellIndex = completionType === CompletionType.currentCellAndAbove ? 0 : cellIndex;

  const diagnostics = languages
    .getDiagnostics()
    .filter(([uri]) => uri.path === notebook.uri.path)
    .flatMap(([, diag]) => diag);

  const cellInfos = notebook.getCells(new NotebookRange(startCellIndex, cellIndex + 1)).map((cell) => {
    const cellProblems = diagnostics.filter((d) => cell.document.validateRange(d.range) === d.range);
    const nonImgOutputs = cell.outputs.flatMap((o) => o.items.filter((i) => !i.mime.startsWith("image"))).map((i) => i.data.toString());
    return { cell, problems: cellProblems, nonImgOutputs };
  });

  var messages: ChatCompletionMessageParam[] = [];

  cellInfos.forEach(({ cell, problems, nonImgOutputs }) => {
    let role: ChatCompletionRole = "user";
    const tags: string[] = cell.metadata?.custom?.metadata?.tags;

    if (tags && tags.length > 0) {
      role = tags[0] as ChatCompletionRole;
    }

    let cellContent = cell.document.getText();

    if (cell.kind === NotebookCellKind.Code) {
      cellContent = `<${Constants.messageMetadata.jupyterCodeCell}>\`\`\`python \n${cellContent}\n\`\`\`</${Constants.messageMetadata.jupyterCodeCell}>`;
    }

    messages.push({ role: role as never, content: cellContent, name: cell.kind.toString() });

    if (problems.length > 0) {
      messages.push({
        role: role ?? "user",
        content: `<${Constants.messageMetadata.jupyterCodeCellProblems}>:\n${problems.map((p) => `${p.code}: ${p.message}`)}\n</${
          Constants.messageMetadata.jupyterCodeCellProblems
        }>`,
      });
    }

    if (nonImgOutputs.length) {
      nonImgOutputs.forEach((output) =>
        messages.push({
          role: role ?? "user",
          content: `<${Constants.messageMetadata.jupyterCodeCellOutput}>\n${output}\n</${Constants.messageMetadata.jupyterCodeCellOutput}>`,
        })
      );
    }
  });

  const systemMessages = messages.filter((m) => m.role === "system");

  // We only add a system message if none was defined
  if (systemMessages.length === 0) {
    messages.push({
      role: "system",
      content:
        "Format your answer as markdown. If you include a markdown code block, specify the language. All the functions or tools you can call are operating within the context of a VSCode workspace.",
    });
  }

  return messages;
}
