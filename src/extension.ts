import axios from "axios";
import { ExtensionContext, NotebookEdit, NotebookRange, ProgressLocation, WorkspaceEdit, commands, window, workspace } from "vscode";
import { generateCompletion } from "./completion";
import { CompletionType } from "./completionType";
import { FinishReason } from "./finishReason";
import { ChatCompletionRequestMessageRoleEnum as Roles } from "openai";
import { errorMessages, models, msgs, prompts } from "./constants";

export async function activate(ctx: ExtensionContext) {
  const regCmd = (cmd: string, handler: (...args: any[]) => any) =>
    ctx.subscriptions.push(commands.registerCommand("notebook-chatcompletion." + cmd, handler));

  regCmd("sendCellAndAbove", (...args) => genCells(args, CompletionType.currentCellAndAbove));
  regCmd("sendCell", (...args) => genCells(args, CompletionType.currentCell));
  regCmd("setRoleAssistant", () => setRole(Roles.Assistant));
  regCmd("setRoleSystem", () => setRole(Roles.System));
  regCmd("setModel", setModel);
  regCmd("setTemperature", () => setParam(prompts.temperature, "temperature", parseFloat, (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1));
  regCmd("setTopP", () => setParam(prompts.topP, "top_p", parseFloat, (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1));
  regCmd("setMaxTokens", () => setParam(prompts.maxTokens, "max_tokens", parseInt, (v) => parseInt(v) > 0));
  regCmd("setPresencePenalty", () =>
    setParam(prompts.presencePenalty, "presence_penalty", parseFloat, (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1)
  );
  regCmd("setFrequencyPenalty", () =>
    setParam(prompts.frequencyPenalty, "frequency_penalty", parseFloat, (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1)
  );
  regCmd("setLogitBias", () =>
    setParam(prompts.logitBias, "logit_bias", JSON.parse, (v) => {
      try {
        JSON.parse(v);
        return null;
      } catch (e) {
        return msgs.logitValidJson;
      }
    })
  );
  regCmd("setUser", () =>
    setParam(
      prompts.user,
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
            window.showErrorMessage(msgs.apiViolation);
            progress.report({ increment: 100 });
            break;
          default:
            throw new Error(errorMessages.unhandledFinishReason);
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
              detail = errorMessages.maxTokenLimit;
              break;
            case 401:
              detail = errorMessages.apiKeyOrg;
              break;
            case 404:
              detail = errorMessages.endpointModel;
              break;
            case 429:
              detail = errorMessages.rateLimit;
              break;
            case 500:
              detail = errorMessages.serverError;
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
  const model = await window.showQuickPick(models, {
    placeHolder: prompts.selectModel,
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

async function setRole(role: Roles) {
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
