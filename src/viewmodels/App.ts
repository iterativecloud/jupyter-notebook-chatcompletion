/* eslint-disable @typescript-eslint/naming-convention */
import { TiktokenModel } from "@dqbd/tiktoken";
import OpenAI from "openai";
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "openai/resources";
import { Stream } from "openai/streaming";
import {
  CancellationToken,
  ExtensionContext,
  NotebookCellKind,
  NotebookDocument,
  NotebookEdit,
  NotebookEditor,
  NotebookRange,
  OutputChannel,
  ProgressLocation,
  QuickPickItem,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import { Constants } from "../Constants";
import { FinishReason } from "../models/FinishReason";
import { Tool } from "../models/Tool";
import { ToolCallExecutionResult } from "../models/ToolCallExecutionResult";
import { CompletionType } from "../models/completionType";
import { findFilesTool } from "../tools/findFiles";
import { readFilesTool } from "../tools/readFileTool";
import { appendTextToCell, convertCellsToMessages, insertCell, updateToolResultsCellMetadata } from "../utilities/cellUtils";
import { bufferWholeChunks, streamChatCompletion } from "../utilities/streamUtils";
import { applyTokenReductions, countTokens, getTokenLimit, getValidAlternativeIfAvailable } from "../utilities/tokenUtils";
import { AppConfig } from "./AppConfig";

export class App {
  public static current: App;
  public tools: Tool[];
  public output: OutputChannel;
  public activeNotebook?: NotebookDocument;
  public extensionContext: ExtensionContext;
  public config!: AppConfig;

  /**
   * Create a new instance of the App class.
   * @param extensionContext The extension context.
   */
  constructor(extensionContext: ExtensionContext) {
    this.output = window.createOutputChannel(extensionContext.extension.packageJSON.displayName, "json");
    this.extensionContext = extensionContext;
    this.tools = [findFilesTool, readFilesTool];

    // Register event handler to track the active notebook and update the metadata
    this.extensionContext.subscriptions.push(
      window.onDidChangeActiveNotebookEditor((editor) => this.onDidChangeActiveNotebookEditor(editor))
    );

    // Initialize the active notebook
    this.onDidChangeActiveNotebookEditor(window.activeNotebookEditor);
  }
  /**
   * Called when the active notebook editor has changed.
   * @param editor The notebook editor that has been activated.
   */
  private onDidChangeActiveNotebookEditor(editor: NotebookEditor | undefined) {
    // It's important to keep track of the last active notebook as the user might switch outside
    // of any notebook while the extension is still processing and accessing the notebook
    if (editor?.notebook) {
      this.activeNotebook = editor?.notebook;
      this.config = new AppConfig(editor?.notebook);
    }
  }

  public async generateCells(cellIndex: number, completionType: CompletionType) {
    await window.withProgress(
      {
        title: Constants.genNextCell,
        location: ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, cancelToken) => {
        try {
          let functionCallResults: ToolCallExecutionResult[] = [];
          let finishReasonOrToolsCall: FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[] = FinishReason.null;

          do {
            if (cancelToken.isCancellationRequested) {
              return;
            }

            await this.waitForUIDispatch();
            // Send the request to OpenAI and generate completions or functional calls
            finishReasonOrToolsCall = await this.generateCompletion(cellIndex, completionType, progress, functionCallResults, cancelToken);

            // Make sure the last generated cell will switch from edit mode to normal mode (markdown will be rendered instead of showing markdown code)
            await commands.executeCommand("notebook.cell.quitEdit");

            // Any previously existing function call results have now been used and can be cleared
            functionCallResults = [];

            // If we received function call requests in the response, we execute them and save the results for the next loop run that will send them in a new request
            if (Array.isArray(finishReasonOrToolsCall) && finishReasonOrToolsCall.length > 0) {
              let toolsCalls: ChatCompletionChunk.Choice.Delta.ToolCall[] = finishReasonOrToolsCall;
              const promiseArray: Promise<any>[] = []; // Array to hold all the promises.

              const toolsCallsWithUserDecision = await this.promptToolExecutions(toolsCalls, cancelToken);

              for (const toolCall of toolsCallsWithUserDecision) {
                for (const tool of this.tools) {
                  if (toolCall.function?.name === tool.toolName) {
                    // If there is already a (negative) result because the user declined the execution, we don't execute the tool call
                    const promise = toolCall.result === "" ? tool.execute(toolCall) : Promise.resolve(toolCall);
                    promise.then((result) => {
                      App.current.output.appendLine("___Tool call result___________________________");
                      App.current.output.appendLine(JSON.stringify(result.result));
                    });

                    promiseArray.push(promise);
                  }
                }

                functionCallResults = await Promise.all(promiseArray);
                updateToolResultsCellMetadata(window.activeNotebookEditor!, cellIndex, functionCallResults);
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
                window.showInformationMessage(Constants.compCompleted);
                progress.report({ increment: 100 });
                break;
              case FinishReason.cancelled:
                window.showInformationMessage(Constants.compCancelled);
                progress.report({ increment: 100 });
                break;
              case FinishReason.contentFilter:
                window.showErrorMessage(Constants.apiViolation);
                progress.report({ increment: 100 });
                break;
              default:
                throw new Error(Constants.unhandledFinishReason);
            }
          } while (finishReasonOrToolsCall === FinishReason.null || Array.isArray(finishReasonOrToolsCall));
        } catch (e: any) {
          if (e.code && e.code === "ECONNRESET") {
            window.showErrorMessage(`${Constants.compFailed}: ${e.message}`, {
              detail: Constants.connectionReset,
              modal: true,
            });
            return;
          }

          let detail = "";
          if (e.response) {
            switch (e.response.status) {
              case 400:
                detail = Constants.maxTokenLimit;
                break;
              case 401:
                detail = Constants.apiKeyOrg;
                break;
              case 404:
                detail = Constants.endpointModel;
                break;
              case 429:
                detail = Constants.rateLimit;
                break;
              case 500:
                detail = Constants.serverError;
                break;
            }
          }
          detail += e instanceof Error ? e.message : String(e);
          window.showErrorMessage(`${Constants.compFailed}: ${e.message}`, {
            detail,
            modal: true,
          });
        }
      }
    );
  }

  public async generateCompletion(
    cellIndex: number,
    completionType: CompletionType,
    progress: { report: (value: { increment: number; message: string }) => void },
    functionCallResults: ToolCallExecutionResult[],
    cancelToken: CancellationToken
  ): Promise<FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[]> {
    let messages = await convertCellsToMessages(cellIndex, completionType);
    let ck: NotebookCellKind | undefined = undefined;

    // Add previous function call results if any have been passed to this function
    if (functionCallResults.length > 0) {
      functionCallResults.forEach((funcResult) => {
        const assistantMessage: ChatCompletionAssistantMessageParam = {
          name: funcResult.function!.name!,
          role: "assistant",
          tool_calls: [
            {
              id: funcResult.id!,
              type: funcResult.type!,
              function: { name: funcResult.function!.name!, arguments: funcResult.function!.arguments! },
            },
          ],
        };

        const toolMessage: ChatCompletionToolMessageParam = { role: "tool", content: funcResult.result, tool_call_id: funcResult.id! };

        messages.push(assistantMessage);
        messages.push(toolMessage);
      });
    }

    const openai = new OpenAI({ apiKey: await App.current.config.getOpenAIApiKey() });

    if (!this.config.notebookMetadata?.model) {
      const result = await this.config.promptOpenAIModelSelection();
      if (!result) {
        throw new Error(Constants.modelNotSet);
      }
    }

    const model: TiktokenModel = this.config.notebookMetadata?.model as TiktokenModel;
    let knownTikTokenModel: TiktokenModel = getValidAlternativeIfAvailable(model);

    const limit = getTokenLimit(model);

    progress.report({ message: Constants.calculatingTokens, increment: 1 });
    await App.current.waitForUIDispatch();

    let skipTokenization = false;

    const currentTools: ChatCompletionTool[] = App.current.tools.map((tool) => {
      const func: ChatCompletionTool = {
        type: "function",
        function: {
          name: tool.toolName,
          description: tool.toolDescription,
          parameters: {
            type: "object",
            properties: tool.properties,
            required: tool.required,
          },
        },
      };
      return func;
    });

    try {
      const totalTokenCount = countTokens(messages, currentTools, knownTikTokenModel);

      if (limit !== null && totalTokenCount > limit) {
        const tokenOverflow = totalTokenCount - limit;

        progress.report({ message: Constants.calculatingTokeReductions, increment: 1 });
        await App.current.waitForUIDispatch();

        const reducedMessages = await applyTokenReductions(messages, tokenOverflow, limit, currentTools, knownTikTokenModel);

        if (!reducedMessages) {
          return FinishReason.cancelled;
        }

        messages = reducedMessages;
      }
    } catch (error: any) {
      skipTokenization = true;
      window.showWarningMessage("Error while counting tokens - skipping token limit checks", {
        modal: false,
        detail:
          "We couldn't count the tokens. This can happen for newer, unknown models (this extension has to be updated).\n" + error.message,
      });
    }

    let reqParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: model,
      messages: messages,
      temperature: this.config.notebookMetadata?.temperature,
      frequency_penalty: this.config.notebookMetadata?.frequency_penalty,
      logit_bias: this.config.notebookMetadata?.logit_bias,
      top_p: this.config.notebookMetadata?.top_p,
      n: this.config.notebookMetadata?.n,
      presence_penalty: this.config.notebookMetadata?.presence_penalty,
      user: this.config.notebookMetadata?.user,
      max_tokens: this.config.notebookMetadata?.max_tokens ?? limit,
      tools: currentTools,
      stream: true,
    };

    if (limit) {
      if (!skipTokenization) {
        const reducedTokenCount = countTokens(messages, currentTools, knownTikTokenModel);
        reqParams.max_tokens = limit - reducedTokenCount;
      }

      if (reqParams.max_tokens && reqParams.max_tokens < 1) {
        const result = await window.showInformationMessage(
          `The request is estimated to be ${-reqParams.max_tokens} tokens over the limit (including the input) and will likely be rejected from the OpenAI API. Do you still want to proceed?`,
          { modal: true },
          "Yes"
        );
        if (result !== "Yes") {
          return FinishReason.cancelled;
        } else {
          // The user still wants to send the requests despite the going over the limit. In that case we completely remove the max_tokens parameter.
          reqParams.max_tokens = undefined;
        }
      }
    }

    App.current.output.appendLine("___Request____________________________________");
    App.current.output.appendLine("\n" + JSON.stringify(reqParams, null, 2));
    progress.report({ increment: 1, message: Constants.sendingRequest });

    const stream = await openai.chat.completions.create(reqParams);
    return await this.streamResponse(stream, cancelToken, cellIndex, ck, progress);
  }

  private async promptToolExecutions(
    toolCalls: ChatCompletionChunk.Choice.Delta.ToolCall[],
    cancellationToken: CancellationToken
  ): Promise<ToolCallExecutionResult[]> {
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

  /**
   * Wait for the UI to dispatch all pending events. This ensures that progress windows are shown immediatly before blocking work is added to the dispatch queue (otherwise, the progress window might be delayed significantly).
   */
  public async waitForUIDispatch() {
    // this is a workaround to make sure the async dispatch queue has been processed
    // so
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  private async streamResponse(
    responseStream: Stream<ChatCompletionChunk>,
    cancelToken: CancellationToken,
    cellIndex: number,
    ck: NotebookCellKind | undefined,
    progress: { report: (value: { increment: number; message: string }) => void }
  ): Promise<FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[]> {
    const editor = window.activeNotebookEditor!;
    App.current.output.show(true);

    let hasPrintedNotebookWriteBanner = false;
    for await (let textTokenOrFinishReason of bufferWholeChunks(streamChatCompletion(responseStream, cancelToken))) {
      // When ToolCall[] is returned
      if (Array.isArray(textTokenOrFinishReason)) {
        App.current.output.appendLine("___Tool calls_________________________________");
        App.current.output.appendLine(JSON.stringify(textTokenOrFinishReason, null, 2));
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
          App.current.output.appendLine("___Writes to Notebook_________________________");
          hasPrintedNotebookWriteBanner = true;
        }
        App.current.output.append(textTokenOrFinishReason.toString());
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

      progress.report({ increment: 0.5, message: Constants.receivingTokens });
    }

    return FinishReason.length;
  }
}
