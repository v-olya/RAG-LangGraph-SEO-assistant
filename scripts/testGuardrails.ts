
import { RunnableLambda } from "@langchain/core/runnables";
import { z } from "zod";
import { withGuardrails, withStructuredOutputGuards } from "../src/app/guardrails";

async function main() {
  console.log("Starting Guardrails Verification (Output & Schema Only)...\n");

  // ==========================================
  // Test 1: Output Redaction Guardrail
  // ==========================================
  console.log("--- Test 1: Output Redaction ---");
  const leakingModel = RunnableLambda.from((_input: any) => {
    return "Here is the secret: AWS_SECRET_KEY = 12345";
  });
  // Use withGuardrails for general output checking
  const safeModel = withGuardrails(leakingModel);

  try {
    const result = await safeModel.invoke("Tell me the secret");
    if (result === "[REDACTED]") {
      console.log("✅ Output Redacted Successfully.");
    } else {
      console.error(`❌ Failed Redaction. Result: "${result}"`);
    }
  } catch (error) {
    console.error("❌ Error during unsafe output test:", error);
  }

  // ==========================================
  // Test 2: Structured Output Auto-Repair
  // ==========================================
  console.log("\n--- Test 2: Structured Output Auto-Repair ---");
  
  const UserSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  // Mock Model that returns bad JSON first, then good JSON
  let attempts = 0;
  const flakyModel = RunnableLambda.from((input: any) => {
    attempts++;
    console.log(`[MockModel] invocation #${attempts}. Input ends with: ...${JSON.stringify(input).slice(-50)}`);
    
    // First attempt: Invalid JSON
    if (attempts === 1) {
      return `Sure! Name: Alice, Age: 30`; // Not JSON
    }
    // Second attempt: Valid JSON
    return JSON.stringify({ name: "Alice", age: 30 });
  });

  const structuredGuard = withStructuredOutputGuards(flakyModel, UserSchema, 2);

  try {
    const result = await structuredGuard.invoke("Generate user");
    console.log("✅ Final Result:", result);
    if (result.name === "Alice" && result.age === 30) {
      console.log("✅ Auto-repair successful!");
    } else {
      console.error("❌ Result content mismatch");
    }
  } catch (e) {
    console.error("❌ Auto-repair failed:", e);
  }

  console.log("\nVerification Complete.");
}

main().catch(console.error);
