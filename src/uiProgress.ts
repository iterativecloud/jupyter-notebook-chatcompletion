import { Progress } from "vscode";

export type UIProgress = Progress<{
  message?: string | undefined;
  increment?: number | undefined;
}>;

export async function waitForUIDispatch() {
  // this is a workaround to make sure the async dispatch queue has been processed
  // so that we the progress window is shown before the current scope blocks the dispatch queue with large work items
  await new Promise<void>((r) => setTimeout(r, 0));
}
