import axios from "axios";
import { ExtensionContext, NotebookEdit, NotebookRange, ProgressLocation, WorkspaceEdit, commands, window, workspace } from "vscode";
import { generateCompletion } from "./completion";
import { CompletionType } from "./completionType";
import { FinishReason } from "./finishReason";

const msgs = {
  genNextCell: "Generating next cell(s)...",
  compCompleted: "Cell generation completed",
  compCancelled: "Generation cancelled",
  compFailed: "Failed to generate new cell(s)",
};

export async function activate(ctx: ExtensionContext) {
  const regCmd = (cmd: string, handler: (...args: any[]) => any) =>
    ctx.subscriptions.push(commands.registerCommand("notebook-chatcompletion." + cmd, handler));

  regCmd("sendCellAndAbove", (...args) => genCells(args, CompletionType.currentCellAndAbove));
  regCmd("sendCell", (...args) => genCells(args, CompletionType.currentCell));
  regCmd("setRoleAssistant", () => setRole("assistant"));
  regCmd("setRoleSystem", () => setRole("system"));
  regCmd("setModel", setModel);
  regCmd("setTemperature", () =>
    setParam("Temperature value (0-1):", "temperature", parseFloat, (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1)
  );
  regCmd("setTopP", () => setParam("Top P value (0-1):", "top_p", parseFloat, (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1));
  regCmd("setMaxTokens", () => setParam("Max Tokens value (integer):", "max_tokens", parseInt, (v) => parseInt(v) > 0));
  regCmd("setPresencePenalty", () =>
    setParam("Presence Penalty value (0-1):", "presence_penalty", parseFloat, (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1)
  );
  regCmd("setFrequencyPenalty", () =>
    setParam("Frequency Penalty value (0-1):", "frequency_penalty", parseFloat, (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1)
  );
  regCmd("setLogitBias", () =>
    setParam("Logit Bias value (JSON object):", "logit_bias", JSON.parse, (v) => {
      try {
        JSON.parse(v);
        return null;
      } catch (e) {
        return "Logit Bias must be a valid JSON object";
      }
    })
  );
  regCmd("setUser", () =>
    setParam(
      "User value (string):",
      "user",
      (v) => v,
      (v) => v.trim().length > 0
    )
  );
}

async function genCells(args: any, completionType: CompletionType) {
  let cellIndex = args[0]?.index;
  if (!cellIndex) {
    cellIndex = window.activeNotebookEditor!.selection.end - 1;
  }
  window.activeNotebookEditor!.selection = new NotebookRange(cellIndex, cellIndex);

  window.withProgress(
    {
      title: msgs.genNextCell,
      location: ProgressLocation.Notification,
      cancellable: true,
    },
    async (progress, cancelToken) => {
      try {
        let finishReason = FinishReason.null;
        finishReason = await generateCompletion(cellIndex, completionType, progress, cancelToken, finishReason);
        await commands.executeCommand("notebook.cell.quitEdit");

        switch (finishReason) {
          case FinishReason.length:
          case FinishReason.stop:
            window.showInformationMessage(msgs.compCompleted);
            progress.report({ increment: 100 });
            break;
          case FinishReason.cancelled:
            window.showInformationMessage(msgs.compCancelled);
            progress.report({ increment: 100 });
            break;
          case FinishReason.contentFilter:
            window.showErrorMessage("OpenAI API finished early due to content policy violation");
            progress.report({ increment: 100 });
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
        if (e.response) {
          switch (e.response.status) {
            case 400:
              detail = "The OpenAI API may return this error when the request goes over the max token limit";
              break;
            case 401:
              detail = "Ensure the correct OpenAI API key and requesting organization are being used.";
              break;
            case 404:
              detail = "The OpenAI endpoint is not found or the requested model is unknown or not available to your account.";
              break;
            case 429:
              detail = "OpenAI Rate limit reached for requests, or you exceeded your current quota or the engine is currently overloaded.";
              break;
            case 500:
              detail = "The OpenAI server had an error while processing your request.";
              break;
          }
        }
        detail += e instanceof Error ? e.message : String(e);
        window.showErrorMessage(`${msgs.compFailed}: ${e.message}`, {
          detail,
          modal: true,
        });
      }
    }
  );
}

async function setModel() {
  const models = ["gpt-4", "gpt-4-0314", "gpt-4-32k", "gpt-4-32k-0314", "gpt-3.5-turbo", "gpt-3.5-turbo-0301", "other"];
  const model = await window.showQuickPick(models, {
    placeHolder: "Select the model:",
  });

  if (model) {
    const editor = window.activeNotebookEditor!;
    const edit = new WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        custom: {
          ...editor.notebook.metadata.custom,
          model: model,
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setParam(prompt: string, key: string, parseFn: (v: string) => any, validateFn: (v: string) => any) {
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
  const cell = editor.notebook.cellAt(editor.selection.end - 1);
  const edit = new WorkspaceEdit();
  edit.set(cell.notebook.uri, [
    NotebookEdit.updateCellMetadata(cell.index, {
      custom: { metadata: { tags: [role] } },
    }),
  ]);
  await workspace.applyEdit(edit);
}
