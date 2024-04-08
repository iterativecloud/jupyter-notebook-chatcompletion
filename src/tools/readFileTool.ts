import OpenAI from "openai";
import { ToolCallWithResult } from "../toolCallWithResult";
import { Uri, workspace } from "vscode";
import { ITool } from "./ITool";
import { output } from "../completion";

export const readFilesTool: ITool = {
  toolName: "readFile",
  toolDescription: "Reads the content of a file in the VSCode workspace and returns it as string.",
  properties: {
    absoluteFilePath: {
      name: "absoluteFilePath",
      type: "string",
      description: "Mandatory parameter. The absolute path to the file to read the content from.",
    },
  },
  executeToolCall: executeToolCall,
  required: ["include"],
};

async function executeToolCall(toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall): Promise<ToolCallWithResult> {
  let filePathParameterUri: Uri | null = null;

  if (toolCall!.function!.arguments) {
    const args = JSON.parse(toolCall!.function!.arguments);
    filePathParameterUri = Uri.parse(args[readFilesTool.properties.absoluteFilePath.name]);
  }

  if (filePathParameterUri !== null) {
    const result = await readFile(filePathParameterUri);
    return {
      function: toolCall.function,
      result: result,
      index: toolCall.index,
      id: toolCall.id,
      type: toolCall.type,
    };
  } else {
    throw new Error("Couldn't parse a valid filePathParameterUri");
  }
}

async function readFile(uri: Uri) {
  const textDoc = await workspace.openTextDocument(uri);
  return textDoc.getText();
}
