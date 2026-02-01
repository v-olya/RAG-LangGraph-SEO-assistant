import { ChatOpenAI } from "@langchain/openai";
import { withGuardrails } from "./guardrails";

export const baseModel = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0,
});

export const baseCheapModel = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
});

export const model = withGuardrails(baseModel);
export const cheapModel = withGuardrails(baseCheapModel);
