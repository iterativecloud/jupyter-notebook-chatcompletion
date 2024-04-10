import { ExtensionContext } from "vscode";
import { Commands } from "./viewmodels/Commands";
import { App } from "./viewmodels/App";

export async function activate(ctx: ExtensionContext) {
  App.current = new App(ctx);
  Commands.registerCommands(ctx);
}
