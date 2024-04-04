import axios, { AxiosResponse } from "axios";
import { CreateChatCompletionResponse } from "openai";
import { CancellationToken, window } from "vscode";
import { FinishReason } from "./finishReason";

export async function* streamChatCompletion(
  response: AxiosResponse<CreateChatCompletionResponse, AsyncIterable<Buffer>>,
  token: CancellationToken
): AsyncGenerator<string | FinishReason, void, undefined> {
  // types are unfortunately not well defined so we have to cast to unknown first to get an AsyncIterable<T>
  const dataStream = response.data as unknown as AsyncIterable<Buffer>;
  let buffer = ""; // Buffer to accumulate chunks

  for await (const chunk of dataStream) {
    if (token.isCancellationRequested) {
      throw new axios.Cancel("ChatCompletion API request cancelled by user");
    }

    // Accumulate chunk into buffer
    buffer += chunk.toString("utf8");

    // Check buffer for complete lines (JSON documents)
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1); // Remove processed line from buffer

      if (!line.startsWith("data: ")) {
        continue; // Ignore if not starting with 'data: '
      } 

      const message = line.replace(/^data: /, "");
      try {
        const json = JSON.parse(message); // Parse the complete JSON document

        const content = json.choices[0].delta.content;

        if (content !== undefined && content !== "") {
          yield content;
        }

        const finishReason = json.choices[0].finish_reason;

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
          case "null": // API response still in progress or incomplete
            continue;
          default: // API returned a stop_reason unknown to us
            throw new Error("Unhandled stop_reason:" + finishReason);
        }
      } catch (error) {
        console.error("Error parsing JSON from chunk:", error);
        // Consider what to do with partial data here, if anything
      }
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
