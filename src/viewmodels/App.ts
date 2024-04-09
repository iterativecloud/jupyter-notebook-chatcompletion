import OpenAI from "openai";
import { window } from "vscode";
import { getOpenAIApiKey } from "../config";
import { NotebookConfiguration } from "../models/NotebookConfiguration";
import { msgs, prompts } from "../constants";

export class App {
  public static current: App = new App();

  public notebookConfig: NotebookConfiguration;

  constructor() {
    this.notebookConfig = new NotebookConfiguration();
  }

  public async setOpenAIModel(): Promise<string | null> {
    const notebook = window.activeNotebookEditor?.notebook;
    if (!notebook) {
      throw new Error(msgs.noActiveNotebook);
    }
    const openaiApiKey = await getOpenAIApiKey();

    if (!openaiApiKey) {
      throw new Error(msgs.apiKeyNotSet);
    }

    const openai = new OpenAI({ apiKey: openaiApiKey });
    // retrieve models from the OpenAI endpoints, sorted by creation date and filtered by the GPT models
    // Note: unfortunately there is information we can check to ensure model compatibility with the ChatCompletion API
    const models = (await openai.models.list()).data
      .sort((a, b) => b.created - a.created)
      .map((x) => x.id)
      .filter((x) => x.startsWith("gpt"));

    const selectedModel = await window.showQuickPick(models, {
      ignoreFocusOut: true,
      placeHolder: prompts.selectModel,
    });

    if (selectedModel) {
      await this.notebookConfig.saveNotebookModel(selectedModel, notebook);
      return selectedModel;
    } else {
      return null;
    }
  }
}
