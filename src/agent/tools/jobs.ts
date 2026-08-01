import { tool } from "ai";
import { z } from "zod";
import { searchAcrossProviders } from "../../jobSearch";
import { safeToolExecution } from "../toolErrors";
import type { AgentToolContext } from "../types";

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
      )
  })
  .strict();

export function createJobsTools(context: AgentToolContext) {
  return {
    searchJobs: tool({
      description:
        "Search jobs through configured providers. Jooble is the default. Use LinkedIn only after the server-configured Browser Run session has been manually logged in. Results are read-only; never fabricate listings.",
      inputSchema: jobSearchToolSchema,
      execute: async ({ keywords, location, sources, linkedinSessionId }) => {
        const effectiveSources =
          sources ||
          (/\blinkedin\b/i.test(context.latestUserText)
            ? (["jooble", "linkedin"] as const)
            : undefined);
        return safeToolExecution(
          () =>
            searchAcrossProviders(context.env, {
              keywords,
              location,
              sources: effectiveSources,
              linkedinSessionId
            }),
          "Job search is temporarily unavailable. Please try again."
        );
      }
    })
  };
}
