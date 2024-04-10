import { OpenAI } from "openai";
import { ToolCallExecutionResult } from "./ToolCallExecutionResult";
import { ChatCompletionChunk } from "openai/resources/chat/completions";

type PropertyItem = {
  type: string;
  properties: {
    [key: string]: {
      type: string;
      description: string;
    };
  };
  required: string[];
};

type Property = {
  name: string;
  type: string;
  description: string;
  items?: PropertyItem;
};

type Properties = {
  [key: string]: Property;
};

export abstract class Tool {
  required: [key: string];
  toolName: string;
  toolDescription: string;
  properties: Properties;

  constructor(required: [key: string], toolName: string, toolDescription: string, properties: Properties) {
    this.required = required;
    this.toolName = toolName;
    this.toolDescription = toolDescription;
    this.required = required;
    this.properties = properties;
  }

  abstract execute(toolCall: ChatCompletionChunk.Choice.Delta.ToolCall): Promise<ToolCallExecutionResult>;
}
