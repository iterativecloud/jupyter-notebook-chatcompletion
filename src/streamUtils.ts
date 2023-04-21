import axios, { AxiosResponse } from "axios";
import { CreateChatCompletionResponse } from "openai";
import { CancellationToken } from "vscode";
import { FinishReason } from "./finishReason";
import { output } from "./extension";

export async function* streamChatCompletion(
  response: AxiosResponse<CreateChatCompletionResponse, AsyncIterable<Buffer>>,
  token: CancellationToken): AsyncGenerator<string | FinishReason, void, undefined> {
  // types are unfortunately not well defined so we have to cast to unknown first to get an AsyncIterable<T>
  const dataStream = response.data as unknown as AsyncIterable<Buffer>;

  for await (const chunk of dataStream) {
    if (token.isCancellationRequested) {
      throw new axios.Cancel("ChatCompletion API request cancelled by user");
    }

    const lines = chunk
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim().startsWith("data: "));

    for (const line of lines) {
      const message = line.replace(/^data: /, "");
      const json = JSON.parse(message);

      const content = json.choices[0].delta.content;

      if (content !== undefined) {
        yield content;
      }

      const finishReason = json.choices[0].finish_reason;

      switch (finishReason) {
        case "length": // Incomplete model output due to max_tokens parameter or token limit
          output.append("FINISH_REASON_LENGTH" + "\n");
          yield FinishReason.length;

        case "content_filter": // Omitted content due to a flag from OpenAI content filters
          output.append("FINISH_REASON_CONTENTFILTER" + "\n");
          yield FinishReason.contentFilter;

        case "stop": // API returned complete model output.
          output.append("FINISH_REASON_STOP" + "\n");
          yield FinishReason.stop;

        case null:
        case undefined:
        case "null": // API response still in progress or incomplete
          continue;
        default: // API returned a stop_reason unknown to us
          throw new Error("Unhandled stop_reason:" + finishReason);
      }
    }
  }
}
