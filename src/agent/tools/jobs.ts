import { tool } from "ai";
import { z } from "zod";
import { searchJobs } from "../../jobSearch";
import { safeToolExecution } from "../toolErrors";
import { toolFailure, type AgentToolContext } from "../types";

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
      .describe("Optional city, region, country, or remote preference.")
  })
  .strict();

export function createJobsTools(context: AgentToolContext) {
  return {
    searchJobs: tool({
      description:
        "Search current Jooble postings for jobs, internships, openings, roles, or companies hiring. Use only for a real job search, not general career advice. Useful keywords are required; location is optional. This reads external data and never creates or changes anything. If no listings are returned, do not fabricate results.",
      inputSchema: jobSearchToolSchema,
      execute: async ({ keywords, location }) => {
        const apiKey = context.env.JOOBLE_API_KEY?.trim();
        if (!apiKey) {
          return toolFailure(
            "CONFIGURATION_ERROR",
            "Job search is not configured. Add JOOBLE_API_KEY as a Cloudflare secret."
          );
        }

        return safeToolExecution(
          async () => ({
            jobs: await searchJobs(apiKey, { keywords, location })
          }),
          "Job search is temporarily unavailable. Please try again."
        );
      }
    })
  };
}
