import { Runnable, RunnableLambda, RunnableConfig } from "@langchain/core/runnables";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { z, ZodSchema } from "zod";
import { StructuredOutputParser } from "@langchain/core/output_parsers";

export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailError";
  }
}

// Output Guardrails: Runs after the model
export async function outputGuardrail(output: any): Promise<any> {
  const textContent = extractTextFromOutput(output);

  const sensitiveKeywords = ["SECRET_KEY", "API_KEY", "ACCESS_KEY", "ROLE_KEY", "ACCESS_TOKEN"];
  if (sensitiveKeywords.some(keyword => textContent.includes(keyword))) {
     if (output instanceof AIMessage) {
        return new AIMessage({ ...output, content: "[REDACTED]" });
     }
     return "[REDACTED]";
  }

  return output;
}

// Helper to extract text from various LangChain input types
function extractTextFromOutput(output: any): string {
   if (typeof output === "string") return output;
   if (output.content) return output.content;
   return JSON.stringify(output);
}

// Middleware Wrapper (General)
export function withGuardrails<RunInput, RunOutput>(
  runnable: Runnable<RunInput, RunOutput>
): Runnable<RunInput, RunOutput> {
  return RunnableLambda.from(async (input: RunInput) => {
      // 1. Execute Runnable (Model)
      const output = await runnable.invoke(input);
      
      // 2. Output Guardrail
      const safeOutput = await outputGuardrail(output);
      
      return safeOutput;
  });
}

// Structured Output Guardrail with Auto-Repair
export function withStructuredOutputGuards<T>(
  runnable: Runnable, 
  schema: ZodSchema<T>, 
  maxRetries = 2
): Runnable<any, T> {
  const parser = StructuredOutputParser.fromZodSchema(schema);

  return RunnableLambda.from(async (input: any, config?: RunnableConfig) => {
    let currentInput = input;
    let attempts = 0;
    
    while (attempts <= maxRetries) {
      try {
        // 1. Invoke Model
        const result = await runnable.invoke(currentInput, config);
        const rawOutput = extractTextFromOutput(result);

        // 2. Output Check (Safety)
        const safeRawOutput = await outputGuardrail(rawOutput);

        // 3. Schema Enforcement
        const parsed = await parser.parse(safeRawOutput);
        return parsed;

      } catch (error) {
        attempts++;
        console.warn(`[Guardrail] Schema validation failed (Attempt ${attempts}/${maxRetries}):`, error instanceof Error ? error.message : "Known error");

        if (attempts > maxRetries) {
            throw new GuardrailError(`Failed to generate valid structured output after ${maxRetries} retries.`);
        }

        // Auto-Repair: Feedback Loop
        
        const errorMessage = error instanceof Error ? error.message : "Invalid JSON format.";
        const repairPrompt = `\n\nSYSTEM: The previous output failed validation with error: "${errorMessage}". Please try again and ensure you strictly follow the format instructions.`;

        if (typeof currentInput === "string") {
            currentInput += repairPrompt;
        } else if (Array.isArray(currentInput)) {
             // Append to message history
             currentInput = [...currentInput, new AIMessage("..."), new HumanMessage({ content: repairPrompt })]; // Simplified
        } else {
             // If complex object, we might just fail or try naive append
             console.log("Cannot auto-repair non-string/list input cleanly. Retrying same input.");
        }
      }
    }
    throw new Error("Unreachable");
  });
}
