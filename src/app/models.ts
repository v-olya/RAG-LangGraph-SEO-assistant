import { ChatOpenAI } from "@langchain/openai";

export const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0,
});

export const cheapModel = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
});
