import { ChatCompletionChunk } from "openai/resources";


export type ToolCallWithResult = ChatCompletionChunk.Choice.Delta.ToolCall & { result: string; };
