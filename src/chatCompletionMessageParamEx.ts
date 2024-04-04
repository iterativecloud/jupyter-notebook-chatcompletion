import { ChatCompletionMessageParam } from "openai/resources";

export type ChatCompletionMessageParamEx = ChatCompletionMessageParam & { name: string; };
