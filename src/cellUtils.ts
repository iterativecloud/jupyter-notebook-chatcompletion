import {
  ChatCompletionRequestMessage,
  ChatCompletionRequestMessageRoleEnum,
} from "openai";
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
import { CompletionType } from "./completionType";

const ADDITIONAL_PROMPT_INFO_MESSAGE =
  "Select any additional information you want to include in the prompt";

export async function appendTextToCell(
  editor: NotebookEditor,
  cellIndex: number,
  textToken: string
) {
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
  edit.insert(
    existingCell.document.uri,
    existingCell.document.positionAt(9999999999),
    textToken
  );
  await workspace.applyEdit(edit);
}

export async function insertCell(
  editor: NotebookEditor,
  cellIndex: number,
  cellKind: NotebookCellKind,
  languageId: string
) {
  // Whenever we insert a cell, we remove any superfluous linebreaks in the previous cell
  const existingCell = editor.notebook.cellAt(cellIndex);
  if (existingCell.document.getText().endsWith("\n")) {
    const edit = new WorkspaceEdit();
    const lastLineRange = existingCell.document.validateRange(
      new Range(
        existingCell.document.lineCount - 2,
        9999999999,
        existingCell.document.lineCount,
        0
      )
    );

    edit.delete(existingCell.document.uri, lastLineRange);
    await workspace.applyEdit(edit);
  }

  await commands.executeCommand("notebook.cell.quitEdit");

  if (cellKind === NotebookCellKind.Code && languageId === "python") {
    await commands.executeCommand("notebook.cell.insertCodeCellBelow", [
      { index: cellIndex },
    ]);
  } else {
    await commands.executeCommand("notebook.cell.insertMarkdownCellBelow", [
      { index: cellIndex },
    ]);
  }

  const edit = new WorkspaceEdit();
  let cell = editor.notebook.cellAt(cellIndex);
  edit.set(cell.notebook.uri, [
    NotebookEdit.updateCellMetadata(cell.index, {
      custom: { metadata: { tags: ["assistant"] } },
    }),
  ]);
  await workspace.applyEdit(edit);
  cell = editor.notebook.cellAt(cellIndex);

  cellIndex++;
  return cellIndex;
}

export async function convertCellsToMessages(
  cellIndex: number,
  completionType: CompletionType
): Promise<ChatCompletionRequestMessage[]> {
  const editor = window.activeNotebookEditor!;
  const notebook = editor.notebook;

  const startCellIndex =
    completionType === CompletionType.currentCellAndAbove ? 0 : cellIndex;

  const diagnostics = languages
    .getDiagnostics()
    .filter(([uri]) => uri.path === notebook.uri.path)
    .flatMap(([, diag]) => diag);

  const cellInfos = notebook
    .getCells(new NotebookRange(startCellIndex, cellIndex + 1))
    .map((cell) => {
      const problems = diagnostics.filter(
        (d) => cell.document.validateRange(d.range) === d.range
      );
      const nonImgOutputs = cell.outputs
        .flatMap((o) => o.items.filter((i) => !i.mime.startsWith("image")))
        .map((i) => i.data.toString());
      return { cell, problems, nonImgOutputs };
    });

  const options = cellInfos.some((c) => c.problems.length)
    ? [`Add Problems (${cellInfos.reduce((a, c) => a + c.problems.length, 0)})`]
    : [];
  if (cellInfos.some((c) => c.nonImgOutputs.length)) {
    options.push(
      `Add Outputs (${cellInfos.reduce(
        (a, c) => a + c.nonImgOutputs.length,
        0
      )})`
    );
  }

  var messages: ChatCompletionRequestMessage[] = [];
  const selectedOptions =
    options.length > 0
      ? await window.showQuickPick(options, {
          placeHolder: ADDITIONAL_PROMPT_INFO_MESSAGE,
          canPickMany: true,
        })
      : [];

  cellInfos.forEach(({ cell, problems, nonImgOutputs }) => {
    let role: ChatCompletionRequestMessageRoleEnum =
      ChatCompletionRequestMessageRoleEnum.User;
    const tags: string[] = cell.metadata?.custom?.metadata?.tags;

    if (tags && tags.length > 0) {
      role = tags[0] as ChatCompletionRequestMessageRoleEnum;
    }
    
    messages.push({ role: role, content: cell.document.getText() });

    if (problems.length && selectedOptions?.includes(options[0])) {
      messages.push({
        role: role ?? "user",
        content:
          "\nPREVIOUS CELL ERRORS:\n" +
          problems.map((p) => `${p.code}: ${p.message}`),
      });
    }

    if (nonImgOutputs.length && selectedOptions?.includes(options[1])) {
      nonImgOutputs.forEach((o) =>
        messages.push({
          role: role ?? "user",
          content: "\nPREVIOUS CELL OUTPUT:\n" + o,
        })
      );
    }
  });

  const totalLengthUserMessages = messages.reduce(
    (accumulator, currentValue) => {
      return accumulator + currentValue.content.length;
    },
    0
  );

  // When the user's input is very short, the large language model tend to pay too much attention to the system message and starts to speak about it, which is confusing for the user. Empirically, length 32 seems to be a good threshold to avoid this.
  if (totalLengthUserMessages > 32) {
    messages.push({
      role: ChatCompletionRequestMessageRoleEnum.System,
      content:
        "Format your answer as markdown. If you include a markdown code block, specify the language.",
    });
  }

  return messages;
}
