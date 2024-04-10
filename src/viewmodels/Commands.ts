import { Command, ExtensionContext, commands, window } from "vscode";
import { CompletionType } from "../models/completionType";
import { Constants } from "../Constants";
import { App } from "./App";

export class Commands {
  public static registerCommands(ctx: ExtensionContext) {
    const commandImplementations = Object.getOwnPropertyNames(Commands)
      .filter((propertyName) => typeof (Commands as any)[propertyName] === "function")
      .map((propertyName) => (Commands as any)[propertyName]);

    for (const command of ctx.extension.packageJSON.contributes.commands as Command[]) {
      const commandFn = commandImplementations.find((ci) => command.command.endsWith(ci.name));
      if (commandFn) {
        ctx.subscriptions.push(
          commands.registerCommand(command.command, async (...args) => {
            try {
              if (!App.current.activeNotebook) {
                window.showWarningMessage("No active notebook found. Please open a notebook and try again.");
                return;
              }

              if (!App.current.config) {
                window.showWarningMessage("Notebook configuration is not loaded.");
                return;
              }

              await commandFn();
            } catch (error: any) {
              window.showErrorMessage(error.toString());
            }
          })
        );
        console.info(`Registred command binding for ${command.command}`);
      } else {
        console.error(`Command binding not found for ${command.command}`);
      }
    }
  }

  public static async sendCellAndAbove() {
    if (window.activeNotebookEditor) {
      const cellIndex = window.activeNotebookEditor.selection.end - 1;
      await App.current.generateCells(cellIndex, CompletionType.currentCellAndAbove);
    }
  }

  public static async sendCell() {
    if (window.activeNotebookEditor) {
      const cellIndex = window.activeNotebookEditor.selection.end - 1;
      await App.current.generateCells(cellIndex, CompletionType.currentCell);
    }
  }

  public static async setRoleAssistant() {
    if (window.activeNotebookEditor) {
      const cellIndex = window.activeNotebookEditor.selection.end - 1;
      await App.current.config.setCellChatRole("assistant", cellIndex);
    }
  }

  public static async setRoleSystem() {
    if (window.activeNotebookEditor) {
      const cellIndex = window.activeNotebookEditor.selection.end - 1;
      await App.current.config.setCellChatRole("system", cellIndex);
    }
  }
  public static async setModel() {
    await App.current.config.promptOpenAIModelSelection();
  }

  public static async setTemperature() {
    await App.current.config.promptOpenAIParameter(
      Constants.temperature,
      "temperature",
      (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1,
      parseFloat
    );
  }

  public static async setTopP() {
    await App.current.config.promptOpenAIParameter(Constants.topP, "top_p", (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1, parseFloat);
  }

  public static async setN() {
    await App.current.config.promptOpenAIParameter(Constants.nCount, "n", (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1, parseFloat);
  }

  public static async setMaxTokens() {
    await App.current.config.promptOpenAIParameter(Constants.maxTokens, "max_tokens", (v) => parseInt(v) > 0, parseInt);
  }

  public static async setUser() {
    await App.current.config.promptOpenAIParameter(Constants.user, "user", (v) => v.trim().length > 0);
  }

  public static async setPresencePenalty() {
    await App.current.config.promptOpenAIParameter(
      Constants.presencePenalty,
      "presence_penalty",
      (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1,
      parseFloat
    );
  }

  public static async setFrequencyPenalty() {
    await App.current.config.promptOpenAIParameter(
      Constants.presencePenalty,
      "frequency_penalty",
      (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1,
      parseFloat
    );
  }

  public static async setLogitBias() {
    await App.current.config.promptOpenAIParameter(
      Constants.logitBias,
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
    );
  }
}
