import { ChatCompletionChunk } from "openai/resources";
import { Stream } from "openai/streaming";
import { CancellationError, CancellationToken } from "vscode";
import { FinishReason } from "../finishReason";
import { getOpenAIApiKey } from "../config";
import OpenAI from "openai";

export async function* streamChatCompletion(
  responseStream: Stream<ChatCompletionChunk>,
  token: CancellationToken
): AsyncGenerator<string | FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[]> {
  for await (const part of responseStream) {
    if (token.isCancellationRequested) {
      yield FinishReason.cancelled;
    }

    try {
      const finishReason = part.choices[0].finish_reason;

      switch (finishReason) {
        case "function_call":
        case "tool_calls": // The model wants to call a tool
          yield FinishReason.toolsCall;
          break;
        case "length": // Incomplete model output due to max_tokens parameter or token limit
          yield FinishReason.length;
          break;

        case "content_filter": // Omitted content due to a flag from OpenAI content filters
          yield FinishReason.contentFilter;
          break;

        case "stop": // API returned complete model output.
          yield FinishReason.stop;
          break;
        case null:
        case undefined:
          // If there are tool_calls, we return them instead
          if (part.choices[0].delta.tool_calls) {
            yield part.choices[0].delta.tool_calls;
            continue;
          }
          const content = part.choices[0].delta.content;

          if (content !== undefined && content !== "" && content !== null) {
            yield content;
          }
          continue; // API response still in progress or incomplete
        default: // API returned a FinishReason unknown to us
          throw new Error("Unhandled FinishReason:" + finishReason);
      }
    } catch (error) {
      console.error("Error parsing response stream:", error);
      throw error;
    }
  }
}

export async function* bufferWholeChunks(
  stream: AsyncGenerator<string | FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[]>
): AsyncGenerator<string | FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[]> {
  let buffer = "";
  let value: string | void | FinishReason | ChatCompletionChunk.Choice.Delta.ToolCall[] = undefined;

  let toolCallDeltas: ChatCompletionChunk.Choice.Delta.ToolCall[][] = [];

  while ((value = (await stream.next()).value)) {
    if (Array.isArray(value)) {
      toolCallDeltas.push(value);
    } else if (
      typeof value === "string" &&
      !value.includes("\n") &&
      !value.includes(" ") &&
      !value.includes("-") &&
      !value.includes("<") &&
      !value.includes(">") &&
      !value.includes("(") &&
      !value.includes(")") &&
      !value.includes(",") &&
      !value.includes(".") &&
      !value.includes("'") &&
      !value.includes('"')
    ) {
      buffer += value;
    } else {
      // Merge and purge tool call deltas
      if (toolCallDeltas.length > 0) {
        yield await mergeToolCallDeltas(toolCallDeltas);
        toolCallDeltas = [];
      }
      // Merge and purge content deltas
      if (buffer.length > 0) {
        yield buffer + (typeof value === "string" ? value : "");
        buffer = "";
      } else {
        yield value;
      }
    }
  }
}

async function mergeToolCallDeltas(
  toolCallDeltas: ChatCompletionChunk.Choice.Delta.ToolCall[][]
): Promise<ChatCompletionChunk.Choice.Delta.ToolCall[]> {
  const mergedToolCallsMap: Map<number, ChatCompletionChunk.Choice.Delta.ToolCall> = new Map();

  for (const deltaGroup of toolCallDeltas) {
    for (const delta of deltaGroup) {
      let mergedToolCall = mergedToolCallsMap.get(delta.index);

      if (!mergedToolCall) {
        // Initialize with the first delta, ensuring function.arguments is handled as a fragment
        mergedToolCall = {
          ...delta,
          function: delta.function ? { ...delta.function, arguments: delta.function.arguments ?? "" } : undefined,
        };
        mergedToolCallsMap.set(delta.index, mergedToolCall);
      } else {
        // Merge subsequent deltas
        if (delta.id) {
          mergedToolCall.id = delta.id;
        }
        if (delta.type) {
          mergedToolCall.type = delta.type;
        }
        if (delta.function) {
          const existingArgs = mergedToolCall.function?.arguments ?? "";
          const newArgs = delta.function.arguments ?? "";
          mergedToolCall.function = {
            name: delta.function.name ?? mergedToolCall.function?.name,
            arguments: existingArgs + newArgs,
          };
        }
      }
    }
  }

  // Attempt to parse the complete JSON document for each ToolCall's arguments, if applicable
  for (const [index, toolCall] of mergedToolCallsMap.entries()) {
    if (toolCall.function && toolCall.function.arguments) {
      try {
        const parsedArgs = JSON.parse(toolCall.function.arguments);
        toolCall.function.arguments = JSON.stringify(parsedArgs); // Re-stringify to clean up any concatenation artifacts
      } catch (error) {
        console.warn(`Unable to parse JSON arguments for ToolCall with index ${index}:`, error);

        try {
          const openaiApiKey = await getOpenAIApiKey();
          const openai = new OpenAI({ apiKey: openaiApiKey });

          let reqParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
            model: "gpt-4",
            messages: [
              { role: "system", content: "You transform every user message into a valid JSON document." },
              { role: "user", content: "{include:**/*.*}" },
              { role: "assistant", content: '{"include":"**/*.*"}' },
              { role: "user", content: toolCall.function.arguments },
            ],
            temperature: 0,
          };
          const stream = await openai.chat.completions.create(reqParams);
          const parsedArgs = JSON.parse(stream.choices[0].message.content!);
          toolCall.function.arguments = JSON.stringify(parsedArgs); // Re-stringify to clean up any concatenation artifacts
        } catch (error) {
          console.error(`Unable to parse JSON arguments for ToolCall with index ${index}:`, error);
          throw error;
        }
      }
    }
  }

  return Array.from(mergedToolCallsMap.values());
}
