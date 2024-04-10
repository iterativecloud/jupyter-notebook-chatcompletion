import { ChatCompletionChunk } from "openai/resources";


export type ToolCallExecutionResult = ChatCompletionChunk.Choice.Delta.ToolCall & { result: string; };
