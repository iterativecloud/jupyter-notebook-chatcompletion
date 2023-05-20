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

const msgs = {
  genNextCell: "Generating next cell(s)...",
  compCompleted: "Cell generation completed",
  compCancelled: "Generation cancelled",
  compFailed: "Failed to generate new cell(s)",
};

function regCmd(
  ctx: ExtensionContext,
  cmd: string,
  cb: (...args: any[]) => any
) {
  ctx.subscriptions.push(commands.registerCommand(cmd, cb));
}

export async function activate(ctx: ExtensionContext) {
  const p = "notebook-chatcompletion.";
  regCmd(ctx, p + "sendCellAndAbove", (...a) =>
    genCells(a, CompletionType.currentCellAndAbove)
  );
  regCmd(ctx, p + "sendCell", (...a) =>
    genCells(a, CompletionType.currentCell)
  );
  regCmd(ctx, p + "setRoleAssistant", () => setRole("assistant"));
  regCmd(ctx, p + "setRoleSystem", () => setRole("system"));
  regCmd(ctx, p + "setModel", () => setModel());
  regCmd(ctx, p + "setTemperature", () =>
    setParam(
      "Temperature value (0-1):",
      "temperature",
      parseFloat,
      (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1
    )
  );
  regCmd(ctx, p + "setTopP", () =>
    setParam(
      "Top P value (0-1):",
      "top_p",
      parseFloat,
      (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1
    )
  );
  regCmd(ctx, p + "setMaxTokens", () =>
    setParam(
      "Max Tokens value (integer):",
      "max_tokens",
      parseInt,
      (v) => parseInt(v) > 0
    )
  );
  regCmd(ctx, p + "setPresencePenalty", () =>
    setParam(
      "Presence Penalty value (0-1):",
      "presence_penalty",
      parseFloat,
      (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1
    )
  );
  regCmd(ctx, p + "setFrequencyPenalty", () =>
    setParam(
      "Frequency Penalty value (0-1):",
      "frequency_penalty",
      parseFloat,
      (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1
    )
  );
  regCmd(ctx, p + "setLogitBias", () =>
    setParam(
      "Logit Bias value (JSON object):",
      "logit_bias",
      JSON.parse,
      (v) => {
        try {
          JSON.parse(v);
          return null;
        } catch (e) {
          return "Logit Bias must be a valid JSON object";
        }
      }
    )
  );
  regCmd(ctx, p + "setUser", () =>
    setParam(
      "User value (string):",
      "user",
      (v) => v,
      (v) => v.trim().length > 0
    )
  );
}

function getErrMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

async function genCells(a: any, ct: CompletionType) {
  let ci = a[0]?.index;
  if (!ci) {
    ci = window.activeNotebookEditor!.selection.end - 1;
  }
  window.activeNotebookEditor!.selection = new NotebookRange(ci, ci);

  window.withProgress(
    {
      title: msgs.genNextCell,
      location: ProgressLocation.Notification,
      cancellable: true,
    },
    async (p, t) => {
      try {
        let fr = FinishReason.null;
        fr = await generateCompletion(ci, ct, p, t, fr);
        await commands.executeCommand("notebook.cell.quitEdit");

        switch (fr) {
          case FinishReason.length:
          case FinishReason.stop:
            window.showInformationMessage(msgs.compCompleted);
            p.report({ increment: 100 });
            break;
          case FinishReason.cancelled:
            window.showInformationMessage(msgs.compCancelled);
            p.report({ increment: 100 });
            break;
          case FinishReason.contentFilter:
            window.showErrorMessage(
              "OpenAI API finished early due to content policy violation"
            );
            p.report({ increment: 100 });
            break;
          default:
            throw new Error("Invalid state: finish_reason wasn't handled.");
        }
      } catch (e: any) {
        if (e instanceof axios.Cancel) {
          window.showInformationMessage(`${msgs.compCancelled}: ${e.message}`);
          return;
        }
        let detail = "";
        if (!e.response) {
          detail = getErrMsg(e);
        } else {
          switch (e.response.status) {
            case 400:
              detail =
                "The OpenAI API may return this error when the request goes over the max token limit";
              break;
            case 401:
              detail =
                "Ensure the correct OpenAI API key and requesting organization are being used.";
              break;
            case 404:
              detail =
                "The OpenAI endpoint is not found or the requested model is unknown or not available to your account.";
              break;
            case 429:
              detail =
                "OpenAI Rate limit reached for requests, or you exceeded your current quota or the engine is currently overloaded.";
              break;
            case 500:
              detail =
                "The OpenAI server had an error while processing your request.";
              break;
          }
        }
        detail += getErrMsg(e);
        window.showErrorMessage(`${msgs.compFailed}: ${e.message}`, {
          detail,
          modal: true,
        });
      }
    }
  );
}

async function setModel() {
  const models = [
    "gpt-4",
    "gpt-4-0314",
    "gpt-4-32k",
    "gpt-4-32k-0314",
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-0301",
    "other",
  ];
  const selectedModel = await window.showQuickPick(models, {
    placeHolder: "Select the model:",
  });

  if (selectedModel) {
    const editor = window.activeNotebookEditor!;
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          model: selectedModel,
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setParam(
  prompt: string,
  key: string,
  parseFn: (v: string) => any,
  validateFn: (v: string) => any
) {
  const editor = window.activeNotebookEditor!;
  const value = await window.showInputBox({
    prompt,
    validateInput: validateFn,
  });

  if (value) {
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          [key]: parseFn(value),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setRole(role: string) {
  const editor = window.activeNotebookEditor!;
  const cellIndex = editor.selection.end - 1;
  const cell = editor.notebook.cellAt(cellIndex);

  const edit = new WorkspaceEdit();
  edit.set(cell.notebook.uri, [
    NotebookEdit.updateCellMetadata(cell.index, {
      custom: { metadata: { tags: [role] } },
    }),
  ]);
  await workspace.applyEdit(edit);
}
