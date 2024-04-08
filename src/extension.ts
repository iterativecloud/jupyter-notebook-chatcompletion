import OpenAI from "openai";
import { ChatCompletionChunk, ChatCompletionRole } from "openai/resources";
import {
  CancellationToken,
  ExtensionContext,
  NotebookEdit,
  NotebookRange,
  ProgressLocation,
  QuickPickItem,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import { CompletionType } from "./completionType";
import { getOpenAIApiKey } from "./config";
import { errorMessages, msgs, prompts, tools } from "./constants";
import { FinishReason } from "./finishReason";
import { generateCompletion } from "./generateCompletion";
import { ToolCallWithResult } from "./toolCallWithResult";
import { waitForUIDispatch } from "./uiProgress";
import { output } from "./completion";
import { ToolCall } from "openai/resources/beta/threads/runs/steps";

export async function activate(ctx: ExtensionContext) {
  const regCmd = (cmd: string, handler: (...args: any[]) => any) =>
    ctx.subscriptions.push(commands.registerCommand("notebook-chatcompletion." + cmd, handler));

  regCmd("sendCellAndAbove", (...args) => genCells(args, CompletionType.currentCellAndAbove));
  regCmd("sendCell", (...args) => genCells(args, CompletionType.currentCell));
  regCmd("setRoleAssistant", () => setRole("assistant"));
  regCmd("setRoleSystem", () => setRole("system"));
  regCmd("setModel", setModel);
  regCmd("setTemperature", () => setParam(prompts.temperature, "temperature", (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1, parseFloat));
  regCmd("setTopP", () => setParam(prompts.topP, "top_p", (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1, parseFloat));
  regCmd("setMaxTokens", () => setParam(prompts.maxTokens, "max_tokens", (v) => parseInt(v) > 0, parseInt));
  regCmd("setUser", () => setParam(prompts.user, "user", (v) => v.trim().length > 0));
  regCmd("setPresencePenalty", () =>
    setParam(prompts.presencePenalty, "presence_penalty", (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1, parseFloat)
  );
  regCmd("setFrequencyPenalty", () =>
    setParam(prompts.frequencyPenalty, "frequency_penalty", (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1, parseFloat)
  );
  regCmd("setLogitBias", () =>
    setParam(
      prompts.logitBias,
      "logit_bias",
      (v) => {
        try {
          JSON.parse(v);
          return true;
        } catch (e) {
          return false;
        }
      },
      JSON.parse
    )
  );
}

async function genCells(args: any, completionType: CompletionType) {
  let cellIndex = args[0]?.index;
  if (!cellIndex) {
    cellIndex = window.activeNotebookEditor!.selection.end - 1;
  }
  window.activeNotebookEditor!.selection = new NotebookRange(cellIndex, cellIndex);

  await window.withProgress(
    {
      title: msgs.genNextCell,
      location: ProgressLocation.Notification,
      cancellable: true,
    },
    async (progress, cancelToken) => {
      try {
        let functionCallResults: ToolCallWithResult[] = [];
        let finishReasonOrToolsCall: FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[] = FinishReason.null;

        do {
          if (cancelToken.isCancellationRequested) {
            return;
          }

          await waitForUIDispatch();
          // Send the request to OpenAI and generate completions or functional calls
          finishReasonOrToolsCall = await generateCompletion(cellIndex, completionType, progress, functionCallResults, cancelToken);

          // Make sure the last generated cell will switch from edit mode to normal mode (markdown will be rendered instead of showing markdown code)
          await commands.executeCommand("notebook.cell.quitEdit");

          // Any previously existing function call results have now been used and can be cleared
          functionCallResults = [];

          // If we received function call requests in the response, we execute them and save the results for the next loop run that will send them in a new request
          if (Array.isArray(finishReasonOrToolsCall) && finishReasonOrToolsCall.length > 0) {
            let toolsCalls: ChatCompletionChunk.Choice.Delta.ToolCall[] = finishReasonOrToolsCall;
            const promiseArray: Promise<any>[] = []; // Array to hold all the promises.

            const toolsCallsWithUserDecision = await promptToolExecutions(toolsCalls, cancelToken);

            for (const toolCall of toolsCallsWithUserDecision) {
              for (const tool of tools) {
                if (toolCall.function?.name === tool.toolName) {
                  // If there is already a (negative) result because the user declined the execution, we don't execute the tool call
                  const promise = toolCall.result === "" ? tool.executeToolCall(toolCall) : Promise.resolve(toolCall);
                  promise.then((result) => {
                    output.appendLine("___Tool call result___________________________");
                    output.appendLine(JSON.stringify(result.result));
                  });

                  promiseArray.push(promise);
                }
              }

              functionCallResults = await Promise.all(promiseArray);
            }

            continue;
          }

          switch (finishReasonOrToolsCall) {
            case FinishReason.toolsCall:
              window.showInformationMessage("The model requested a local function execution");
              progress.report({ increment: 10 });
            case FinishReason.null:
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
        } while (finishReasonOrToolsCall === FinishReason.null || Array.isArray(finishReasonOrToolsCall));
      } catch (e: any) {
        if (e.code && e.code === "ECONNRESET") {
          window.showErrorMessage(`${msgs.compFailed}: ${e.message}`, {
            detail: msgs.connectionReset,
            modal: true,
          });
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

export async function setModel(): Promise<string | undefined> {
  const openaiApiKey = await getOpenAIApiKey();

  if (!openaiApiKey) {
    throw new Error(msgs.apiKeyNotSet);
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  const models = (await openai.models.list()).data.map((x) => x.id).filter((x) => x.startsWith("gpt"));

  const model = await window.showQuickPick(models, {
    ignoreFocusOut: true,
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

  return model;
}

async function setParam(prompt: string, key: string, validateFn: (v: string) => any, parseFn: ((v: string) => any) | null = null) {
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
          [key]: parseFn === null ? value : parseFn(value),
        },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}

async function setRole(role: ChatCompletionRole) {
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

export async function promptToolExecutions(
  toolCalls: ChatCompletionChunk.Choice.Delta.ToolCall[],
  cancellationToken: CancellationToken
): Promise<ToolCallWithResult[]> {
  type QuickPickWithToolId = QuickPickItem & {
    toolCallId: string;
  };

  let availableToolCalls: QuickPickWithToolId[] = toolCalls.map<QuickPickWithToolId>((t) => ({
    toolCallId: t.id!,
    label: t.function!.name!,
    description: t.function!.arguments,
    picked: true,
  }));

  const selectedStrategies = await window.showQuickPick(
    availableToolCalls,
    {
      ignoreFocusOut: true,
      canPickMany: true,
      title: `The OpenAI model wants to call the following functions. Please choose which functions are allowed to execute and their results sent back to the OpenAI model.`,
    },
    cancellationToken
  );

  return toolCalls.map((toolCall) => {
    const isPicked = selectedStrategies?.some((s) => s.picked && s.toolCallId === toolCall.id!);
    return { ...toolCall, result: isPicked ? "" : "The user declined the execution of this tool call" };
  });
}
