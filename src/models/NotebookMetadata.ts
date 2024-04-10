/* eslint-disable @typescript-eslint/naming-convention */
import { NotebookEdit, WorkspaceEdit, workspace, NotebookDocument } from "vscode";
import { ParameterKey } from "./ParameterKey";

export class NotebookMetadata {
  public temperature?: number;
  public frequency_penalty?: number;
  public logit_bias?: Record<string, number>;
  public top_p?: number;
  public n?: number;
  public presence_penalty?: number;
  public user?: string;
  public max_tokens?: number;
  public model?: string;

  constructor(notebook: NotebookDocument) {
    this.temperature = this.getFloat(notebook, "temperature");
    this.frequency_penalty = this.getFloat(notebook, "frequency_penalty");
    this.logit_bias = this.geRecord(notebook, "logit_bias");
    this.top_p = this.getFloat(notebook, "top_p");
    this.n = this.getInt(notebook, "n");
    this.presence_penalty = this.getFloat(notebook, "presence_penalty");
    this.user = this.getString(notebook, "user") ?? undefined;
    this.max_tokens = this.getInt(notebook, "max_tokens");
    this.model = this.getString(notebook, "model");
  }

  private getString(notebook: NotebookDocument, key: string): string | undefined {
    try {
      const chatcompletion = notebook?.metadata?.custom?.metadata?.chatcompletion;
      const hasValue = chatcompletion ? (chatcompletion[key] as string) !== undefined : undefined;
      if (hasValue) {
        return chatcompletion[key] as string;
      } else {
        return undefined;
      }
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  private getInt(notebook: NotebookDocument, key: string): number | undefined {
    try {
      const chatcompletion = notebook?.metadata?.custom?.metadata?.chatcompletion;
      const hasValue = chatcompletion ? chatcompletion[key] !== undefined : undefined;
      if (hasValue) {
        return parseInt(chatcompletion[key]);
      } else {
        return undefined;
      }
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  private getFloat(notebook: NotebookDocument, key: string): number | undefined {
    try {
      const chatcompletion = notebook?.metadata?.custom?.metadata?.chatcompletion;
      const hasValue = chatcompletion ? chatcompletion[key] !== undefined : undefined;
      if (hasValue) {
        return parseFloat(chatcompletion[key]);
      } else {
        return undefined;
      }
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  private geRecord(notebook: NotebookDocument, key: string): Record<string, number> | undefined {
    try {
      const objString = this.getString(notebook, key);
      if (objString) {
        return undefined;
      } else {
        if (objString === undefined) {
          return undefined;
        } else {
          return JSON.parse(objString) as Record<string, number>;
        }
      }
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  public async saveNotebookSetting(
    key: ParameterKey,
    value: string | number | Record<string, number | undefined>,
    notebook: NotebookDocument
  ) {
    const edit = new WorkspaceEdit();
    edit.set(notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        ...notebook.metadata,
        custom: {
          metadata: {
            ...notebook.metadata.custom.metadata,
            chatcompletion: {
              ...notebook.metadata.custom.metadata.chatcompletion,
              [key]: value,
            },
          },
        },
      }),
    ]);

    switch (key) {
      case "frequency_penalty":
        this.frequency_penalty = value as number;
        break;
      case "logit_bias":
        this.logit_bias = value as Record<string, number>;
        break;
      case "max_tokens":
        this.max_tokens = value as number;
        break;
      case "model":
        this.model = value as string;
        break;
      case "n":
        this.n = value as number;
        break;
      case "presence_penalty":
        this.presence_penalty = value as number;
        break;
      case "temperature":
        this.temperature = value as number;
        break;
      case "top_p":
        this.top_p = value as number;
        break;
      case "user":
        this.user = value as string;
        break;
      default:
        throw new Error(`Unknown ParameterKey: ${key}`);
    }

    await workspace.applyEdit(edit);

    this[key] = value as any;
  }
}
