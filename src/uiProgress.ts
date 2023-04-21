import { Progress } from "vscode";

export type UIProgress = Progress<{
  message?: string | undefined;
  increment?: number | undefined;
}>;
