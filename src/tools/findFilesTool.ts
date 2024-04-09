import OpenAI from "openai";
import { ToolCallWithResult } from "../toolCallWithResult";
import { workspace } from "vscode";
import { ITool } from "./ITool";
import path = require("path");

export const findFilesTool: ITool = {
  toolName: "findFiles",
  toolDescription: "Find files across all workspace folders in the VSCode workspace (case-sensitive). Returns a comma-separated list of file paths relative to the workspace folder.",
  properties: {
    include: {
      name: "include",
      type: "string",
      description:
        "A glob pattern that defines the files to search for, which is case-sensitive and must always search across multiple directory levels.",
    },
  },
  executeToolCall: executeToolCall,
  required: ["include"],
};

async function executeToolCall(toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall): Promise<ToolCallWithResult> {
  let includeParameter: string | null = null;

  if (toolCall!.function!.arguments) {
    const args = JSON.parse(toolCall!.function!.arguments);
    if (args[findFilesTool.properties.include.name]) {
      includeParameter = args[findFilesTool.properties.include.name];
    }
  }

  const result = includeParameter === null ? await findNonIgnoredFiles() : await findNonIgnoredFiles(includeParameter);
  let resultText = `No results with findFile for your include parameter '${includeParameter}'`;

  if (result.length > 0) {
    const workspaceFolderPath = workspace.workspaceFolders![0].uri.fsPath!;

    // Convert each file path in the result to a path relative to the workspace folder
    resultText = result
      .map((filePath) => path.relative(workspaceFolderPath, filePath.fsPath))
      .join(",");
  }
  return {
    function: toolCall.function,
    result: resultText,
    index: toolCall.index,
    id: toolCall.id,
    type: toolCall.type,
  };
}

async function findNonIgnoredFiles(pattern: string | null = null) {
  const exclude = [
    ...Object.keys((await workspace.getConfiguration("search", null).get("exclude")) || {}),
    ...Object.keys((await workspace.getConfiguration("files", null).get("exclude")) || {}),
  ].join(",");

  if (pattern) {
    return await workspace.findFiles(pattern, `{${exclude}}`);
  } else {
    return await workspace.findFiles("**/*.*", `{${exclude}}`);
  }
}
