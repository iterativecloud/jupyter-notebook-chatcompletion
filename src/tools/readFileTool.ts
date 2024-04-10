import OpenAI from "openai";
import { Uri, workspace } from "vscode";
import { Tool } from "../models/Tool";
import { ToolCallExecutionResult } from "../models/ToolCallExecutionResult";
import path = require("path");

export const readFilesTool: Tool = {
  toolName: "readFiles",
  toolDescription: "Reads the content of the given relative file paths in the VSCode workspace and returns it as string.",
  required: ["relativeFilePaths"],
  properties: {
    relativeFilePaths: {
      name: "relativeFilePaths",
      type: "array",
      description: `The file paths relative to the workspace folder '${workspace.workspaceFolders![0].uri.toString()}' to read from.`,
      items: {
        type: "object",
        properties: {
          uri: {
            type: "string",
            description: `Mandatory parameter. The file path to read the content from, relative to '${workspace.workspaceFolders![0].uri.toString()}'`,
          },
        },
        required: ["uri"],
      },
    },
  },
  execute: executeToolCall,
};

async function executeToolCall(toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall): Promise<ToolCallExecutionResult> {
  let filePathUris: Uri[] | null = null;

  if (toolCall!.function!.arguments) {
    const args = JSON.parse(toolCall!.function!.arguments);
    const workspaceFolderPath = workspace.workspaceFolders![0].uri;
    filePathUris = args[readFilesTool.properties.relativeFilePaths.name].map((fp: any) =>
      Uri.parse(path.join(workspaceFolderPath.toString(), fp.uri))
    );
  }

  let contents = "";

  if (filePathUris !== null) {
    for (const filePathUri of filePathUris) {
      const textDoc = await workspace.openTextDocument(filePathUri);
      const content = textDoc.getText();
      // const docSymbols: SymbolInformation[] = await commands.executeCommand("vscode.executeWorkspaceSymbolProvider", "");
      // docSymbols.filter((symbol) => symbol.location.uri.toString() === textDoc.uri.toString()).forEach((symbol) => {});
      contents += `\n<File uri="${textDoc.uri.toString()}" lineCount="${textDoc.lineCount}" eol="${textDoc.eol}" languageId="${
        textDoc.languageId
      }" languageId="${textDoc}">\n<![CDATA[${content}]]>\n</File>\n`;
    }

    return {
      function: toolCall.function,
      result: contents,
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
