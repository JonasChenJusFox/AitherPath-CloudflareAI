import { tool } from "ai";
import { z } from "zod";
import {
  resumeParseRequestSchema,
  resumeProfileSchema,
  normalizeResumeProfile
} from "../../resume/schema";
import { safeToolExecution } from "../toolErrors";
import type { AgentToolContext } from "../types";

export function normalizeFileData(fileData: string) {
  // The browser sends a data URL. Keep only the base64 payload so the raw
  // Responses API request can add exactly one media-type prefix.
  const match = fileData.match(/^data:[^;,]+;base64,(.*)$/s);
  return match?.[1] || fileData;
}

export class ResumeParseError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502
  ) {
    super(message);
    this.name = "ResumeParseError";
  }
}

const nullableString = { type: ["string", "null"] } as const;

const resumeResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: nullableString,
    email: nullableString,
    location: nullableString,
    summary: nullableString,
    skills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          level: nullableString,
          evidence: nullableString
        },
        required: ["name", "level", "evidence"]
      }
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          technologies: { type: "array", items: { type: "string" } }
        },
        required: ["name", "description", "technologies"]
      }
    },
    education: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          school: { type: "string" },
          degree: nullableString,
          field: nullableString,
          startDate: nullableString,
          endDate: nullableString
        },
        required: ["school", "degree", "field", "startDate", "endDate"]
      }
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          company: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          technologies: { type: "array", items: { type: "string" } }
        },
        required: ["company", "title", "description", "technologies"]
      }
    }
  },
  required: [
    "name",
    "email",
    "location",
    "summary",
    "skills",
    "projects",
    "education",
    "experience"
  ]
} as const;

type ResponsesBody = {
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  error?: { message?: string } | string;
  incomplete_details?: { reason?: string } | null;
};

function extractOutputText(body: ResponsesBody) {
  if (body.output_text?.trim()) return body.output_text.trim();

  for (const item of body.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text?.trim()) {
        return content.text.trim();
      }
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => optionalValue(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function normalizeModelProfile(value: unknown) {
  const raw = asRecord(value);
  if (!raw)
    throw new ResumeParseError("OpenAI returned an invalid resume object.");

  const emailCandidate = optionalValue(raw.email);
  const email =
    emailCandidate && z.email().safeParse(emailCandidate).success
      ? emailCandidate
      : undefined;

  const skills = Array.isArray(raw.skills)
    ? raw.skills
        .map((item) => {
          const skill = asRecord(item);
          const name = optionalValue(skill?.name);
          return name
            ? {
                name,
                level: optionalValue(skill?.level),
                evidence: optionalValue(skill?.evidence)
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  const projects = Array.isArray(raw.projects)
    ? raw.projects
        .map((item) => {
          const project = asRecord(item);
          const name = optionalValue(project?.name);
          const description = optionalValue(project?.description);
          return name && description
            ? {
                name,
                description,
                technologies: stringList(project?.technologies)
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  const education = Array.isArray(raw.education)
    ? raw.education
        .map((item) => {
          const entry = asRecord(item);
          const school = optionalValue(entry?.school);
          return school
            ? {
                school,
                degree: optionalValue(entry?.degree),
                field: optionalValue(entry?.field),
                startDate: optionalValue(entry?.startDate),
                endDate: optionalValue(entry?.endDate)
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  const experience = Array.isArray(raw.experience)
    ? raw.experience
        .map((item) => {
          const entry = asRecord(item);
          const company = optionalValue(entry?.company);
          const title = optionalValue(entry?.title);
          const description = optionalValue(entry?.description);
          return company && title && description
            ? {
                company,
                title,
                description,
                technologies: stringList(entry?.technologies)
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  return normalizeResumeProfile({
    name: optionalValue(raw.name),
    email,
    location: optionalValue(raw.location),
    summary: optionalValue(raw.summary),
    skills,
    projects,
    education,
    experience
  });
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

export async function parseResumeText(env: Env, request: unknown) {
  const input = resumeParseRequestSchema.parse(request);
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ResumeParseError(
      "OpenAI PDF parsing is not configured. Add OPENAI_API_KEY.",
      503
    );
  }

  const fileData = input.fileData
    ? `data:${input.mediaType};base64,${normalizeFileData(input.fileData)}`
    : null;
  const inputItems = [
    {
      role: "system",
      content:
        "Extract only information explicitly present in the resume. Do not invent dates, technologies, employers, or contact details. Return null for missing scalar values, empty arrays for missing lists, and omit incomplete project or experience records by returning an empty list entry only when the record is supported by the document."
    },
    {
      role: "user",
      content: [
        ...(fileData
          ? [
              {
                type: "input_file",
                filename: input.fileName || "resume.pdf",
                file_data: fileData,
                ...(input.mediaType === "application/pdf"
                  ? { detail: "low" }
                  : {})
              }
            ]
          : []),
        {
          type: "input_text",
          text: `Extract a factual resume profile from ${input.fileName || "the supplied resume"}.${input.text ? `\n\nResume text:\n${input.text}` : ""}`
        }
      ]
    }
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
      input: inputItems,
      text: {
        format: {
          type: "json_schema",
          name: "resume_profile",
          strict: true,
          schema: resumeResponseSchema
        }
      },
      max_output_tokens: 5000,
      store: false
    })
  });

  const rawBody = await response.text();
  let body: ResponsesBody = {};
  try {
    body = JSON.parse(rawBody) as ResponsesBody;
  } catch {
    // Keep the generic status message below for non-JSON upstream responses.
  }

  if (!response.ok) {
    const upstreamMessage =
      typeof body.error === "string"
        ? body.error
        : body.error?.message || "The Responses API rejected the request.";
    throw new ResumeParseError(
      `OpenAI resume parsing failed (${response.status}): ${upstreamMessage}`,
      response.status >= 500 ? 502 : response.status
    );
  }

  if (body.status === "incomplete") {
    throw new ResumeParseError(
      `OpenAI returned an incomplete resume profile${body.incomplete_details?.reason ? ` (${body.incomplete_details.reason})` : ""}.`
    );
  }

  const outputText = extractOutputText(body);
  if (!outputText) {
    throw new ResumeParseError(
      "OpenAI did not return a structured resume profile."
    );
  }

  try {
    return normalizeModelProfile(JSON.parse(outputText));
  } catch (error) {
    if (error instanceof ResumeParseError) throw error;
    throw new ResumeParseError(
      "OpenAI returned a resume profile that could not be validated."
    );
  }
}
