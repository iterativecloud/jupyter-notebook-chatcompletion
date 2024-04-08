import OpenAI from "openai";
import { ToolCallWithResult } from "../toolCallWithResult";


export interface ITool {
  required: unknown;
  toolName: string;
  toolDescription: string;
  properties: {
    [key: string]: {
      name: string;
      type: string;
      description: string;
    };
  };
  executeToolCall(toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall): Promise<ToolCallWithResult>;
}
