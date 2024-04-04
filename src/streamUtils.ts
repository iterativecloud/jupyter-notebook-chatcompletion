import { ChatCompletionChunk } from "openai/resources";
import { Stream } from "openai/streaming";
import { CancellationError, CancellationToken } from "vscode";
import { FinishReason } from "./finishReason";

export async function* streamChatCompletion(
  responseStream: Stream<ChatCompletionChunk>,
  token: CancellationToken
): AsyncGenerator<string | FinishReason, void, undefined> {
  for await (const part of responseStream) {
    if (token.isCancellationRequested) {
      yield FinishReason.cancelled;
    }

    try {
      const content = part.choices[0].delta.content;

      if (content !== undefined && content !== "") {
        yield content ?? FinishReason.null;
      }

      const finishReason = part.choices[0].finish_reason;

      switch (finishReason) {
        case "length": // Incomplete model output due to max_tokens parameter or token limit
          yield FinishReason.length;

        case "content_filter": // Omitted content due to a flag from OpenAI content filters
          yield FinishReason.contentFilter;

        case "stop": // API returned complete model output.
          yield FinishReason.stop;
          return;
        case null:
        case undefined:
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
  stream: AsyncGenerator<string | FinishReason, void, undefined>
): AsyncGenerator<string | FinishReason, void, undefined> {
  let buffer = "";
  let value: string | void | FinishReason = undefined;

  while ((value = (await stream.next()).value)) {
    if (
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
      if (buffer.length > 0) {
        yield buffer + (typeof value === "string" ? value : "");
        buffer = "";
      } else {
        yield value;
      }
    }
  }
}
