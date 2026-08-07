import { generateObject, tool } from "ai";
import { z } from "zod";
import {
  resumeParseRequestSchema,
  resumeProfileSchema
} from "../../resume/schema";
import { safeToolExecution } from "../toolErrors";
import type { AgentToolContext } from "../types";

export function normalizeFileData(fileData: string) {
  // The browser sends a data URL. The OpenAI Responses adapter expects the
  // base64 payload only and adds the media-type prefix itself.
  const match = fileData.match(/^data:[^;,]+;base64,(.*)$/s);
  return match?.[1] || fileData;
}

export const saveResumeProfileSchema = resumeProfileSchema
  .extend({ sourceName: z.string().trim().max(240).optional() })
  .strict();

export function createResumeTools(context: AgentToolContext) {
  return {
    getResumeProfile: tool({
      description:
        "Read the user's structured resume profile. Use this before evaluating a job or explaining why a job matches.",
      inputSchema: z.object({}).strict(),
      execute: async () =>
        safeToolExecution(
          async () => ({
            profile: (await context.getResumeProfile?.()) || null
          }),
          "The resume profile could not be loaded."
        )
    }),
    saveResumeProfile: tool({
      description:
        "Save a structured resume profile after the user provides or confirms resume details. Never infer private facts that are not present in the supplied resume.",
      inputSchema: saveResumeProfileSchema,
      execute: async ({ sourceName, ...profile }) => {
        if (!context.saveResumeProfile) {
          return { saved: false, message: "Resume storage is not configured." };
        }
        return safeToolExecution(
          async () => ({
            saved: true,
            profile: await context.saveResumeProfile!(profile, sourceName)
          }),
          "The resume profile could not be saved."
        );
      }
    })
  };
}

export async function parseResumeText(
  model: Parameters<typeof generateObject>[0]["model"],
  providerOptions: Parameters<typeof generateObject>[0]["providerOptions"],
  request: unknown
) {
  const input = resumeParseRequestSchema.parse(request);
  const result = await generateObject({
    model,
    providerOptions,
    schema: resumeProfileSchema,
    schemaName: "resume_profile",
    schemaDescription:
      "A factual, structured representation of a resume for job matching.",
    system:
      "Extract only information explicitly present in the resume text. Keep skills, projects, education, and work experience concrete. Do not invent dates, technologies, employers, or contact details.",
    ...(input.fileData
      ? {
          messages: [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `Extract the factual resume profile from ${input.fileName || "the attached file"}.`
                },
                {
                  type: "file" as const,
                  data: normalizeFileData(input.fileData),
                  mediaType: input.mediaType,
                  filename: input.fileName
                }
              ]
            }
          ]
        }
      : {
          prompt: `Resume file: ${input.fileName || "unknown"}\n\n${input.text || ""}`
        })
  });
  return result.object;
}
