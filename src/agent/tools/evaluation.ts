import { tool } from "ai";
import { z } from "zod";
import { evaluateJobMatch } from "../../jobs/evaluation";
import { safeToolExecution } from "../toolErrors";
import type { AgentToolContext } from "../types";

const evaluateJobSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    company: z.string().trim().max(240).optional(),
    location: z.string().trim().max(240).optional(),
    description: z.string().trim().max(12_000).optional(),
    link: z.string().url().optional(),
    source: z.enum(["jooble", "linkedin"]).optional()
  })
  .strict();

export function createEvaluationTools(context: AgentToolContext) {
  return {
    evaluateJobMatch: tool({
      description:
        "Compare a job description with the saved resume profile using Vectorize retrieval and a deterministic score. Only a score strictly above 80 is eligible for Apply; all other jobs are Skip.",
      inputSchema: evaluateJobSchema,
      execute: async (input) =>
        safeToolExecution(async () => {
          const profile = await context.getResumeProfile?.();
          if (!profile) {
            return {
              decision: "skip" as const,
              score: 0,
              reason:
                "No resume profile is saved yet. Upload or save a resume before evaluating jobs."
            };
          }
          const evaluation = await evaluateJobMatch(
            context.env,
            context.getResumeOwnerName?.() || "anonymous",
            profile,
            {
              title: input.title,
              company: input.company || "Unknown company",
              location: input.location || "Unknown location",
              description: input.description,
              link: input.link || "",
              source: input.source || "jooble"
            }
          );
          return evaluation;
        }, "The job could not be evaluated against the resume.")
    })
  };
}
