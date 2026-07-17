import { tool } from "ai";
import { memoryPostSchema } from "../../schemas/week3";
import { safeToolExecution } from "../toolErrors";
import { toolFailure, type AgentToolContext } from "../types";

const SENSITIVE_MEMORY_PATTERN =
  /\b(password|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|oauth|social security|passport number)\b/i;

export const saveMemoryToolSchema = memoryPostSchema.strict();

export function createMemoryTools(context: AgentToolContext) {
  return {
    saveSessionMemory: tool({
      description:
        "Save an additional stable preference, goal, profile detail, or recurring context when the user explicitly asks to remember it. Durable profile facts are also automatically extracted from user messages by the server. Do not use for transient chat content. This changes server-side memory but needs no second confirmation. Never store passwords, API keys, OAuth tokens, secrets, or sensitive identity numbers.",
      inputSchema: saveMemoryToolSchema,
      execute: async ({ key, value }) => {
        if (
          !/\b(remember|save this|save that|keep this)\b/i.test(
            context.latestUserText
          )
        ) {
          return toolFailure(
            "VALIDATION_ERROR",
            "Memory is saved only after an explicit request to remember it."
          );
        }
        if (SENSITIVE_MEMORY_PATTERN.test(`${key} ${value}`)) {
          return toolFailure(
            "VALIDATION_ERROR",
            "Sensitive or secret information cannot be saved to memory."
          );
        }

        return safeToolExecution(
          async () => ({
            saved: true,
            memory: await context.saveMemory(key, value)
          }),
          "The preference could not be saved. Please try again."
        );
      }
    })
  };
}
