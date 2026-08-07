import { tool } from "ai";
import { z } from "zod";
import { searchAcrossProviders } from "../../jobSearch";
import { safeToolExecution } from "../toolErrors";
import type { AgentToolContext } from "../types";
import { evaluateJobMatch } from "../../jobs/evaluation";

export const jobSearchToolSchema = z
  .object({
    keywords: z
      .string()
      .trim()
      .min(2)
      .max(160)
      .describe("Useful job title, skill, internship, or role keywords."),
    location: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .optional()
      .describe("Optional city, region, country, or remote preference."),
    sources: z
      .array(z.enum(["jooble", "linkedin"]))
      .min(1)
      .optional()
      .describe(
        "Optional providers. Defaults to Jooble. LinkedIn requires an active user-assisted browser session."
      ),
    linkedinSessionId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Optional override for a LinkedIn Browser Run session. The server normally supplies this; never ask the user to provide it."
      ),
    evaluateMatches: z
      .boolean()
      .optional()
      .describe(
        "When a saved resume exists, include a match score and Apply/Skip decision for returned jobs."
      )
  })
  .strict();

export function createJobsTools(context: AgentToolContext) {
  return {
    searchJobs: tool({
      description:
        "Search jobs through configured providers. Jooble is the default. Use LinkedIn only after the server-configured Browser Run session has been manually logged in. Results are read-only; never fabricate listings.",
      inputSchema: jobSearchToolSchema,
      execute: async ({ keywords, location, sources, evaluateMatches }) => {
        const effectiveSources =
          sources ||
          (/\blinkedin\b/i.test(context.latestUserText)
            ? (["jooble", "linkedin"] as const)
            : undefined);
        // Session IDs are account-scoped server state. Never let a value typed
        // in chat override the session bound by the Connect LinkedIn flow.
        const activeLinkedInSessionId = effectiveSources?.includes("linkedin")
          ? await context.getLinkedInSessionId?.()
          : undefined;
        return safeToolExecution(
          () =>
            searchAcrossProviders(context.env, {
              keywords,
              location,
              sources: effectiveSources,
              linkedinSessionId: activeLinkedInSessionId || undefined
            }).then(async (result) => {
              const profile =
                evaluateMatches === false
                  ? null
                  : await context.getResumeProfile?.();
              if (!profile) return result;
              const evaluations = await Promise.all(
                result.jobs
                  .slice(0, 10)
                  .map((job) =>
                    evaluateJobMatch(
                      context.env,
                      context.getResumeOwnerName?.() || "anonymous",
                      profile,
                      job
                    )
                  )
              );
              return { ...result, evaluations };
            }),
          "Job search is temporarily unavailable. Please try again."
        );
      }
    })
  };
}
