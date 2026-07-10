import { createWorkersAI } from "workers-ai-provider";
import {
  routeAgentRequest,
  type Connection,
  type ConnectionContext
} from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { searchJobs } from "./jobSearch";
import { handleGoogleRoutes } from "./auth/googleRoutes";
import { handleWeek3Routes } from "./routes/week3";
import { listInboxMessages, sendGmailMessage } from "./google/gmail";
import {
  createCalendarEvent,
  listTodayCalendarEvents
} from "./google/calendar";
import { searchContacts } from "./google/contacts";
import {
  getGoogleOAuthConfig,
  refreshGoogleAccessToken
} from "./auth/googleOAuth";
import {
  getGoogleAccessToken,
  getGoogleRefreshToken
} from "./storage/cookieSession";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import { memoryPostSchema, preferencesPatchSchema } from "./schemas/week3";
import { ApiError, errorJson, getRequestId, successJson } from "./utils/api";

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  private gmailCookieHeader = "";

  private ensureWeek3Tables() {
    this.sql`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY,
        time_zone TEXT NOT NULL,
        default_meeting_duration_minutes INTEGER NOT NULL,
        default_calendar_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS session_memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
  }

  private getPreferences() {
    this.ensureWeek3Tables();
    const rows = this.sql<{
      time_zone: string;
      default_meeting_duration_minutes: number;
      default_calendar_id: string;
      created_at: number;
      updated_at: number;
    }>`SELECT * FROM user_preferences WHERE id = ${"default"} LIMIT 1`;

    if (rows[0]) {
      return {
        timeZone: rows[0].time_zone,
        defaultMeetingDurationMinutes: rows[0].default_meeting_duration_minutes,
        defaultCalendarId: rows[0].default_calendar_id,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at
      };
    }

    const now = Date.now();
    this.sql`
      INSERT INTO user_preferences (
        id,
        time_zone,
        default_meeting_duration_minutes,
        default_calendar_id,
        created_at,
        updated_at
      )
      VALUES (${"default"}, ${"UTC"}, ${30}, ${"primary"}, ${now}, ${now})
    `;

    return {
      timeZone: "UTC",
      defaultMeetingDurationMinutes: 30,
      defaultCalendarId: "primary",
      createdAt: now,
      updatedAt: now
    };
  }

  private async patchPreferences(request: Request) {
    const current = this.getPreferences();
    const input = preferencesPatchSchema.parse(await request.json());
    const updated = {
      timeZone: input.timeZone ?? current.timeZone,
      defaultMeetingDurationMinutes:
        input.defaultMeetingDurationMinutes ??
        current.defaultMeetingDurationMinutes,
      defaultCalendarId: input.defaultCalendarId ?? current.defaultCalendarId,
      createdAt: current.createdAt,
      updatedAt: Date.now()
    };

    this.sql`
      UPDATE user_preferences
      SET
        time_zone = ${updated.timeZone},
        default_meeting_duration_minutes = ${updated.defaultMeetingDurationMinutes},
        default_calendar_id = ${updated.defaultCalendarId},
        updated_at = ${updated.updatedAt}
      WHERE id = ${"default"}
    `;

    return updated;
  }

  private listMemory() {
    this.ensureWeek3Tables();
    return this.sql<{
      key: string;
      value: string;
      created_at: number;
      updated_at: number;
    }>`SELECT key, value, created_at, updated_at FROM session_memory ORDER BY updated_at DESC LIMIT 100`.map(
      (row) => ({
        key: row.key,
        value: row.value,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    );
  }

  private async upsertMemory(request: Request) {
    this.ensureWeek3Tables();
    const input = memoryPostSchema.parse(await request.json());
    return this.saveMemoryValue(input.key, input.value);
  }

  private saveMemoryValue(key: string, value: string) {
    this.ensureWeek3Tables();
    const existing = this.sql<{ created_at: number }>`
      SELECT created_at FROM session_memory WHERE key = ${key} LIMIT 1
    `;
    const now = Date.now();
    const createdAt = existing[0]?.created_at ?? now;

    this.sql`
      INSERT OR REPLACE INTO session_memory (key, value, created_at, updated_at)
      VALUES (${key}, ${value}, ${createdAt}, ${now})
    `;

    return {
      key,
      value,
      createdAt,
      updatedAt: now
    };
  }

  override async fetch(request: Request) {
    const url = new URL(request.url);
    const requestId = getRequestId(request);

    if (url.pathname === "/internal/auth-sync") {
      if (request.headers.get("X-WorkingHelper-Internal") !== "auth-sync") {
        return errorJson(
          new ApiError("AUTHENTICATION_REQUIRED", "Internal route only.", 401),
          requestId
        );
      }

      this.gmailCookieHeader = request.headers.get("Cookie") || "";
      return successJson({ synced: Boolean(this.gmailCookieHeader) });
    }

    if (url.pathname.startsWith("/internal/week3/")) {
      if (request.headers.get("X-WorkingHelper-Internal") !== "week3") {
        return errorJson(
          new ApiError("AUTHENTICATION_REQUIRED", "Internal route only.", 401),
          requestId
        );
      }

      try {
        if (
          url.pathname === "/internal/week3/preferences" &&
          request.method === "GET"
        ) {
          return successJson(this.getPreferences());
        }

        if (
          url.pathname === "/internal/week3/preferences" &&
          request.method === "PATCH"
        ) {
          return successJson(await this.patchPreferences(request));
        }

        if (
          url.pathname === "/internal/week3/memory" &&
          request.method === "GET"
        ) {
          return successJson({ memories: this.listMemory() });
        }

        if (
          url.pathname === "/internal/week3/memory" &&
          request.method === "POST"
        ) {
          return successJson(await this.upsertMemory(request), { status: 201 });
        }

        return errorJson(
          new ApiError("VALIDATION_ERROR", "Unsupported storage route.", 404),
          requestId
        );
      } catch {
        return errorJson(
          new ApiError(
            "STORAGE_ERROR",
            "Unable to access session storage.",
            500
          ),
          requestId
        );
      }
    }

    return super.fetch(request);
  }

  onConnect(_connection: Connection, ctx: ConnectionContext) {
    // The WebSocket upgrade carries the same HttpOnly cookies as normal requests.
    this.gmailCookieHeader = ctx.request.headers.get("Cookie") || "";
  }

  private async getGmailAccessToken() {
    const request = new Request("https://workinghelper.com", {
      headers: {
        Cookie: this.gmailCookieHeader
      }
    });

    const accessToken = getGoogleAccessToken(request);
    if (accessToken) return accessToken;

    const refreshToken = getGoogleRefreshToken(request);
    const config = getGoogleOAuthConfig(this.env);
    if (!refreshToken || !config) return null;

    // Refresh only on the server so the browser never sees the Google client secret.
    const tokens = await refreshGoogleAccessToken(config, refreshToken);
    return tokens.access_token;
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.6", {
        sessionAffinity: this.sessionAffinity
      }),
      system: `You are WorkingHelper, an AI job search assistant. Help users search for jobs, understand job results, manage Gmail-related job search communication, manage calendar events, search contacts, remember useful preferences, and decide useful next steps. When a user asks for jobs, internships, roles, positions, companies hiring, or openings, use the searchJobs tool before answering. Include the job title, company, location, and link when job results are available. If the user does not provide enough search details, ask a short follow-up question.

You can use Gmail tools only when the user has connected Gmail. When a user asks to read recent inbox messages, use listGmailInbox. When a user explicitly asks you to send an email, use sendGmailEmail only after you have a recipient email address, a subject, and the complete body. If any of those details are missing, ask a short follow-up question instead of sending.

You can use Google Calendar and Contacts tools only when the user has connected Google. When a user asks about today's schedule, meetings, or classes, use listTodayCalendarEvents. When a user explicitly asks you to create or schedule a calendar event, use createCalendarEvent only after you have an event title, start time, end time, and time zone. If details are missing, ask a short follow-up question. When a user asks to find a person's email, phone number, or contact details, use searchGoogleContacts.

When a user says to remember a stable preference, goal, profile detail, or recurring context for later, use saveSessionMemory. Do not save secrets, passwords, tokens, or sensitive identity numbers.

Keep answers concise and practical. If the job API returns no useful results, suggest how the user can broaden the search.`,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
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
        }),
        listGmailInbox: tool({
          description:
            "Read recent Gmail inbox messages for the connected user. Use when the user asks to check, read, or summarize recent inbox emails.",
          inputSchema: z.object({
            maxResults: z
              .number()
              .int()
              .min(1)
              .max(10)
              .optional()
              .describe(
                "Maximum number of inbox messages to read, from 1 to 10"
              )
          }),
          execute: async ({ maxResults }) => {
            const accessToken = await this.getGmailAccessToken();

            if (!accessToken) {
              return {
                error:
                  "Gmail is not connected. Ask the user to click Connect Gmail first."
              };
            }

            return {
              messages: await listInboxMessages(accessToken, maxResults ?? 5)
            };
          }
        }),
        sendGmailEmail: tool({
          description:
            "Send a plain-text email from the connected Gmail account. Use only when the user explicitly asks to send an email and provides a recipient email address, subject, and complete body.",
          inputSchema: z.object({
            to: z
              .email()
              .describe("Recipient email address, such as person@example.com"),
            subject: z.string().min(1).describe("Email subject line"),
            body: z.string().min(1).describe("Plain-text email body")
          }),
          execute: async ({ to, subject, body }) => {
            const accessToken = await this.getGmailAccessToken();

            if (!accessToken) {
              return {
                error:
                  "Gmail is not connected. Ask the user to click Connect Gmail first."
              };
            }

            const result = await sendGmailMessage(accessToken, {
              to: to.trim(),
              subject: subject.trim(),
              body: body.trim()
            });

            return {
              sent: true,
              messageId: result.id,
              threadId: result.threadId
            };
          }
        }),
        listTodayCalendarEvents: tool({
          description:
            "List today's Google Calendar events for the connected user. Use when the user asks about today's schedule, meetings, events, or classes.",
          inputSchema: z.object({
            timeZone: z
              .string()
              .describe(
                "IANA time zone for the user's day, such as Asia/Shanghai or America/New_York"
              ),
            maxResults: z
              .number()
              .int()
              .min(1)
              .max(10)
              .optional()
              .describe("Maximum number of calendar events to return")
          }),
          execute: async ({ timeZone, maxResults }) => {
            const accessToken = await this.getGmailAccessToken();

            if (!accessToken) {
              return {
                error:
                  "Google is not connected. Ask the user to click Connect Gmail first."
              };
            }

            return {
              events: await listTodayCalendarEvents(
                accessToken,
                timeZone.trim(),
                maxResults ?? 10
              )
            };
          }
        }),
        createCalendarEvent: tool({
          description:
            "Create a Google Calendar event for the connected user. Use only when the user explicitly asks to schedule or create an event and provides a title, start time, end time, and time zone.",
          inputSchema: z.object({
            summary: z.string().min(1).describe("Calendar event title"),
            startDateTime: z
              .string()
              .datetime({ offset: true })
              .describe(
                "Event start time in RFC3339 format with offset, such as 2026-07-11T14:00:00+08:00"
              ),
            endDateTime: z
              .string()
              .datetime({ offset: true })
              .describe(
                "Event end time in RFC3339 format with offset, such as 2026-07-11T14:30:00+08:00"
              ),
            timeZone: z
              .string()
              .describe("IANA time zone, such as Asia/Shanghai"),
            description: z
              .string()
              .optional()
              .describe("Optional calendar event description"),
            location: z.string().optional().describe("Optional event location"),
            attendeeEmails: z
              .array(z.email())
              .max(20)
              .optional()
              .describe("Optional attendee email addresses")
          }),
          execute: async ({
            summary,
            startDateTime,
            endDateTime,
            timeZone,
            description,
            location,
            attendeeEmails
          }) => {
            const accessToken = await this.getGmailAccessToken();

            if (!accessToken) {
              return {
                error:
                  "Google is not connected. Ask the user to click Connect Gmail first."
              };
            }

            const event = await createCalendarEvent(accessToken, {
              summary: summary.trim(),
              startDateTime,
              endDateTime,
              timeZone: timeZone.trim(),
              description: description?.trim(),
              location: location?.trim(),
              attendeeEmails,
              sendUpdates: "none"
            });

            return {
              created: true,
              event
            };
          }
        }),
        searchGoogleContacts: tool({
          description:
            "Search the connected user's Google Contacts by name, email, company, or keyword. Use when the user asks for a person's email, phone number, or contact details.",
          inputSchema: z.object({
            query: z
              .string()
              .min(1)
              .describe("Contact keyword, name, email, company, or phone text"),
            pageSize: z
              .number()
              .int()
              .min(1)
              .max(10)
              .optional()
              .describe("Maximum contacts to return")
          }),
          execute: async ({ query, pageSize }) => {
            const accessToken = await this.getGmailAccessToken();

            if (!accessToken) {
              return {
                error:
                  "Google is not connected. Ask the user to click Connect Gmail first."
              };
            }

            return {
              contacts: await searchContacts(
                accessToken,
                query.trim(),
                pageSize ?? 10
              )
            };
          }
        }),
        saveSessionMemory: tool({
          description:
            "Save a stable user preference, goal, or recurring context for future conversations. Do not save passwords, tokens, or sensitive identity numbers.",
          inputSchema: z.object({
            key: z
              .string()
              .regex(/^[a-zA-Z0-9:_-]{1,80}$/)
              .describe(
                "Short memory key, such as job_search_goal or preferred_location"
              ),
            value: z
              .string()
              .min(1)
              .max(2000)
              .describe("Memory value to remember for later")
          }),
          execute: async ({ key, value }) => {
            return {
              saved: true,
              memory: this.saveMemoryValue(key, value)
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
    const url = new URL(request.url);

    if (url.pathname === "/api/agent/auth-sync" && request.method === "POST") {
      const agentName = url.searchParams.get("name");
      if (!agentName) {
        return errorJson(
          new ApiError("VALIDATION_ERROR", "Agent name is required.", 400),
          getRequestId(request)
        );
      }

      const agentId = env.ChatAgent.idFromName(agentName);
      const agent = env.ChatAgent.get(agentId);
      const syncUrl = new URL(request.url);
      syncUrl.pathname = "/internal/auth-sync";

      return agent.fetch(
        new Request(syncUrl.toString(), {
          method: "POST",
          headers: {
            Cookie: request.headers.get("Cookie") || "",
            "X-WorkingHelper-Internal": "auth-sync"
          }
        })
      );
    }

    const googleResponse = await handleGoogleRoutes(request, env);
    if (googleResponse) return googleResponse;

    const week3Response = await handleWeek3Routes(request, env);
    if (week3Response) return week3Response;

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
