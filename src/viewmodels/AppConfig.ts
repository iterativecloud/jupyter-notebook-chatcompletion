import { workspace, ConfigurationTarget, window, NotebookEdit, WorkspaceEdit, NotebookDocument, NotebookCell } from "vscode";
import { Constants } from "../Constants";
import OpenAI from "openai";
import { ChatCompletionRole } from "openai/resources";
import { NotebookMetadata } from "../models/NotebookMetadata";
import { ParameterKey } from "../models/ParameterKey";

export class AppConfig {
  private openaiAPIKey?: string;
  private notebook: NotebookDocument;
  public notebookMetadata?: NotebookMetadata;

  constructor(notebook: NotebookDocument) {
    this.notebook = notebook;
    this.notebookMetadata = new NotebookMetadata(notebook);
  }

  public async getOpenAIApiKey(): Promise<string> {
    let openaiAPIKey = workspace.getConfiguration().get<string>(Constants.configKeys.openAiKey);
    if (openaiAPIKey) {
      return openaiAPIKey;
    } else {
      openaiAPIKey = await window.showInputBox({
        ignoreFocusOut: true,
        prompt: Constants.enterApiKey,
        validateInput: (value) => (value.trim().length > 0 ? null : Constants.apiKeyCannotBeEmpty),
      });

      if (openaiAPIKey) {
        await workspace.getConfiguration().update(Constants.configKeys.openAiKey, openaiAPIKey, ConfigurationTarget.Global);
        return openaiAPIKey;
      } else {
        throw new Error(Constants.apiKeyRequired);
      }
    }
  }

  /**
   * Prompts the user to select an OpenAI model and save the result to the active notebook.
   * Remark: as of 2024-04, there is no runtime information we can check to ensure model compatibility with the ChatCompletion API.
   * The user will be able to select models invalid for the ChatCompletion endpoint.
   * @returns The selected model or null if the user cancelled the selection.
   */
  public async promptOpenAIModelSelection(): Promise<string | null> {
    if (!this.notebook) {
      throw new Error(Constants.noActiveNotebook);
    }

    const openai = new OpenAI({ apiKey: await this.getOpenAIApiKey() });
    // we retrieve models from the OpenAI endpoints, sorted by creation date and filtered by the GPT models
    const models = (await openai.models.list()).data
      .sort((a, b) => b.created - a.created)
      .map((x) => x.id)
      .filter((x) => x.startsWith("gpt"));

    const selectedModel = await window.showQuickPick(models, {
      ignoreFocusOut: true,
      placeHolder: Constants.selectModel,
    });

    if (selectedModel && this.notebookMetadata) {
      await this.notebookMetadata.saveNotebookSetting("model", selectedModel, this.notebook);
      return selectedModel;
    } else {
      return null;
    }
  }

  public async promptOpenAIParameter(
    promptMessage: string,
    key: ParameterKey,
    validate: (v: string) => any,
    parse: ((v: string) => any) | null = null
  ) {
    const value = await window.showInputBox({
      prompt: promptMessage,
      validateInput: validate,
    });

    if (value) {
      this.notebookMetadata?.saveNotebookSetting(key, value, this.notebook);
    }
  }

  public async setCellChatRole(role: ChatCompletionRole, cellIndex: number) {
    const editor = window.activeNotebookEditor!;
    const cell = editor.notebook.cellAt(cellIndex);
    const edit = new WorkspaceEdit();
    edit.set(cell.notebook.uri, [
      NotebookEdit.updateCellMetadata(cell.index, {
        custom: { metadata: { tags: [role] } },
      }),
    ]);
    await workspace.applyEdit(edit);
  }
}
