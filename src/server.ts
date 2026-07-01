import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { searchJobs } from "./jobSearch";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.6", {
        sessionAffinity: this.sessionAffinity
      }),
      system: `You are WorkingHelper, an AI job search assistant. Help users search for jobs, understand job results, and decide useful next steps. When a user asks for jobs, internships, roles, positions, companies hiring, or openings, use the searchJobs tool before answering. Include the job title, company, location, and link when job results are available. If the user does not provide enough search details, ask a short follow-up question.

Keep answers concise and practical. If the job API returns no useful results, suggest how the user can broaden the search.`,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        // This is the first real WorkingHelper tool: the model calls it when the user asks for job openings.
        searchJobs: tool({
          description:
            "Search current job postings using keywords and an optional location. Use this whenever the user asks to find jobs, internships, openings, roles, or hiring companies.",
          inputSchema: z.object({
            keywords: z
              .string()
              .describe(
                "Job search keywords, such as frontend engineer, software engineer intern, or data analyst"
              ),
            location: z
              .string()
              .optional()
              .describe("Optional city, state, country, or remote preference")
          }),
          execute: async ({ keywords, location }) => {
            const apiKey = this.env.JOOBLE_API_KEY;

            if (!apiKey) {
              return {
                error:
                  "Job search is not configured. Add JOOBLE_API_KEY as a Cloudflare secret."
              };
            }

            return {
              jobs: await searchJobs(apiKey, {
                keywords: keywords.trim(),
                location: location?.trim()
              })
            };
          }
        })
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
