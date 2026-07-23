import {
  routeAgentRequest,
  type Connection,
  type ConnectionContext
} from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { handleGoogleRoutes } from "./auth/googleRoutes";
import { handleWeek3Routes } from "./routes/week3";
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
  generateObject,
  pruneMessages,
  stepCountIs,
  streamText
} from "ai";
import { z } from "zod";
import { memoryPostSchema, preferencesPatchSchema } from "./schemas/week3";
import { ApiError, errorJson, getRequestId, successJson } from "./utils/api";
import {
  createAgentModel,
  ModelConfigurationError,
  safeModelErrorMessage
} from "./agent/model";
import { buildSystemPrompt } from "./agent/systemPrompt";
import { createToolRegistry } from "./agent/toolRegistry";
import { selectActiveTools } from "./agent/intentRouter";
import { MAX_TOOL_STEPS } from "./agent/orchestration";
import {
  PendingActionService,
  type PendingAction,
  type PendingActionRepository,
  type PendingActionStatus,
  type PendingActionToolName
} from "./agent/pendingActions";
import type { MemoryEntry } from "./agent/types";
import { extractTimeZone } from "./agent/time";
import { indexMemory, retrieveRelevantMemories } from "./agent/memoryRag";
import type { ScheduleMeetingWorkflowParams } from "./workflows/scheduleMeeting";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  type CreateCalendarEventInput
} from "./google/calendar";
import { searchContacts } from "./google/contacts";
import { sendGmailMessage } from "./google/gmail";

type MemorySaveResult =
  | {
      status: "none";
    }
  | {
      status: "blocked";
      reason: string;
    }
  | {
      status: "saved";
      memories: MemoryEntry[];
    };

const profileMemoryExtractionSchema = z.object({
  memories: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .regex(/^profile:[a-zA-Z0-9:_-]{1,70}$/),
        value: z.string().trim().min(1).max(500)
      })
    )
    .max(8)
});

type ProfileMemoryExtraction = z.infer<typeof profileMemoryExtractionSchema>;

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveOAuthKey(secret: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

function preferredTimeZoneFromMemory(memories: MemoryEntry[]) {
  for (const memory of memories) {
    if (/time.?zone|timezone|tz/i.test(memory.key)) {
      const direct = extractTimeZone(memory.value);
      if (direct) return direct;
    }

    if (/preferred|profile|time.?zone|timezone/i.test(memory.value)) {
      const fromSummary = extractTimeZone(memory.value);
      if (fromSummary) return fromSummary;
    }
  }

  return null;
}

function redirectToCanonicalUrl(request: Request) {
  const url = new URL(request.url);
  let shouldRedirect = false;

  if (url.protocol === "http:") {
    url.protocol = "https:";
    shouldRedirect = true;
  }

  if (url.hostname === "www.workinghelper.com") {
    url.hostname = "workinghelper.com";
    shouldRedirect = true;
  }

  return shouldRedirect ? Response.redirect(url.toString(), 301) : null;
}

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  private gmailCookieHeader = "";
  private memoryOwnerName = "";

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

    this.sql`
      CREATE TABLE IF NOT EXISTS pending_actions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        normalized_arguments TEXT NOT NULL,
        preview TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS active_workflows (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS google_credentials (
        id TEXT PRIMARY KEY,
        encrypted_refresh_token TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
  }

  private pendingActionRepository(): PendingActionRepository {
    this.ensureWeek3Tables();

    return {
      insertIfAbsent: (action) => {
        this.sql`
          INSERT OR IGNORE INTO pending_actions (
            id,
            session_id,
            tool_name,
            normalized_arguments,
            preview,
            created_at,
            expires_at,
            status
          ) VALUES (
            ${action.id},
            ${action.sessionId},
            ${action.toolName},
            ${action.normalizedArguments},
            ${action.preview},
            ${action.createdAt},
            ${action.expiresAt},
            ${action.status}
          )
        `;
      },
      get: (id) => {
        const rows = this.sql<{
          id: string;
          session_id: string;
          tool_name: string;
          normalized_arguments: string;
          preview: string;
          created_at: number;
          expires_at: number;
          status: string;
        }>`SELECT * FROM pending_actions WHERE id = ${id} LIMIT 1`;
        const row = rows[0];
        if (!row) return null;

        return {
          id: row.id,
          sessionId: row.session_id,
          toolName: row.tool_name as PendingActionToolName,
          normalizedArguments: row.normalized_arguments,
          preview: row.preview,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          status: row.status as PendingActionStatus
        } satisfies PendingAction;
      },
      cancelPendingForTool: (toolName, exceptId) => {
        this.sql`
          UPDATE pending_actions
          SET status = ${"cancelled"}
          WHERE tool_name = ${toolName}
            AND id <> ${exceptId}
            AND status = ${"pending"}
        `;
      },
      transition: (id, from, to) => {
        const rows = this.sql<{ id: string }>`
          UPDATE pending_actions
          SET status = ${to}
          WHERE id = ${id} AND status = ${from}
          RETURNING id
        `;
        return rows.length === 1;
      }
    };
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

  private listMemory(key?: string) {
    this.ensureWeek3Tables();
    if (key) {
      return this.sql<{
        key: string;
        value: string;
        created_at: number;
        updated_at: number;
      }>`SELECT key, value, created_at, updated_at FROM session_memory WHERE key = ${key} LIMIT 1`.map(
        (row) => ({
          key: row.key,
          value: row.value,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })
      );
    }

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

  private async listSharedMemory(key?: string) {
    if (!this.memoryOwnerName) {
      return this.listMemory(key);
    }

    const agentId = this.env.ChatAgent.idFromName(
      `memory:${this.memoryOwnerName}`
    );
    const agent = this.env.ChatAgent.get(agentId);
    const memoryUrl = new URL(
      "https://workinghelper.com/internal/week3/memory"
    );
    if (key) memoryUrl.searchParams.set("key", key);
    const response = await agent.fetch(
      new Request(memoryUrl, {
        headers: {
          "X-WorkingHelper-Internal": "week3"
        }
      })
    );
    const payload = await response.json<{
      data?: { memories?: MemoryEntry[] };
    }>();

    return payload.data?.memories || [];
  }

  private async saveSharedMemoryValue(key: string, value: string) {
    if (!this.memoryOwnerName) {
      const memory = this.saveMemoryValue(key, value);
      await indexMemory(this.env, "anonymous", memory).catch(() => false);
      return memory;
    }

    const agentId = this.env.ChatAgent.idFromName(
      `memory:${this.memoryOwnerName}`
    );
    const agent = this.env.ChatAgent.get(agentId);
    const response = await agent.fetch(
      new Request("https://workinghelper.com/internal/week3/memory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WorkingHelper-Internal": "week3"
        },
        body: JSON.stringify({ key, value })
      })
    );
    const payload = await response.json<{
      data?: MemoryEntry;
    }>();

    const memory = payload.data || this.saveMemoryValue(key, value);
    await indexMemory(this.env, this.memoryOwnerName, memory).catch(
      () => false
    );
    return memory;
  }

  private async retrieveMemoryContext(query: string) {
    try {
      const memories = await retrieveRelevantMemories(
        this.env,
        this.memoryOwnerName || "anonymous",
        query,
        5
      );
      if (memories.length > 0) return this.memoryContext(memories);

      // One-time-friendly migration path: legacy SQLite memories are used to
      // seed the vector index when a user has no indexed matches yet.
      const legacyMemories = await this.listSharedMemory();
      await Promise.all(
        legacyMemories.map((memory) =>
          indexMemory(
            this.env,
            this.memoryOwnerName || "anonymous",
            memory
          ).catch(() => false)
        )
      );
      return this.memoryContext(legacyMemories.slice(0, 5));
    } catch {
      return "No relevant saved user memory found.";
    }
  }

  private async persistRefreshToken(refreshToken: string) {
    const secret = this.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
    if (!secret || !refreshToken) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveOAuthKey(secret);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(refreshToken)
    );
    this.ensureWeek3Tables();
    this.sql`
      INSERT OR REPLACE INTO google_credentials (id, encrypted_refresh_token, updated_at)
      VALUES (${"default"}, ${`${encodeBase64(iv)}.${encodeBase64(new Uint8Array(encrypted))}`}, ${Date.now()})
    `;
  }

  private async getPersistedRefreshToken() {
    const secret = this.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
    if (!secret) return null;
    this.ensureWeek3Tables();
    const rows = this.sql<{ encrypted_refresh_token: string }>`
      SELECT encrypted_refresh_token FROM google_credentials WHERE id = ${"default"} LIMIT 1
    `;
    const encoded = rows[0]?.encrypted_refresh_token;
    if (!encoded) return null;
    try {
      const [ivEncoded, ciphertextEncoded] = encoded.split(".");
      const key = await deriveOAuthKey(secret);
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decodeBase64(ivEncoded) },
        key,
        decodeBase64(ciphertextEncoded)
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      return null;
    }
  }

  private async cancelActiveWorkflowForIntentChange(text: string) {
    if (
      !/calendar|meeting|appointment|schedule|instead|actually|contact/i.test(
        text
      )
    ) {
      return;
    }
    this.ensureWeek3Tables();
    const active = this.sql<{ id: string; workflow_id: string }>`
      SELECT id, workflow_id FROM active_workflows
      WHERE workflow_name = ${"SCHEDULE_MEETING_WORKFLOW"}
      LIMIT 1
    `;
    if (!active[0]) return;
    await this.terminateWorkflow(active[0].workflow_id).catch(() => undefined);
    this.sql`DELETE FROM active_workflows WHERE id = ${active[0].id}`;
  }

  private memoryContext(memories: MemoryEntry[]) {
    if (memories.length === 0) {
      return "No saved user memory yet.";
    }

    return memories
      .map((memory) => `- ${memory.key}: ${memory.value}`)
      .join("\n");
  }

  private messageText(message: unknown) {
    const candidate = message as {
      role?: string;
      content?: unknown;
      parts?: Array<{ type?: string; text?: string }>;
    };

    if (typeof candidate.content === "string") {
      return candidate.content;
    }

    if (Array.isArray(candidate.parts)) {
      return candidate.parts
        .map((part) => (part.type === "text" ? part.text || "" : ""))
        .join("")
        .trim();
    }

    return "";
  }

  private latestUserMessageText() {
    for (const message of [...this.messages].reverse()) {
      const candidate = message as { role?: string };

      if (candidate.role === "user") {
        return this.messageText(message);
      }
    }

    return "";
  }

  private async autoSaveExplicitMemory(
    text: string
  ): Promise<MemorySaveResult> {
    const cleanText = text.trim();
    if (!/\b(remember|save this|save that|keep this)\b/i.test(cleanText)) {
      return { status: "none" };
    }

    if (
      /\b(password|secret|token|api key|access token|refresh token)\b/i.test(
        cleanText
      )
    ) {
      return {
        status: "blocked",
        reason:
          "The user asked to save sensitive or secret information. Do not store it, and clearly tell the user it was not saved."
      };
    }

    const rememberedText = cleanText
      .replace(/^(please\s+)?remember\s+(that\s+)?/i, "")
      .replace(/^(please\s+)?save\s+(this|that)\s*:?/i, "")
      .trim();

    const saved = [
      await this.saveSharedMemoryValue(
        "profile:summary",
        rememberedText || cleanText
      )
    ];

    const nameMatch = rememberedText.match(
      /\bmy name is\s+([A-Za-z][A-Za-z\s.'-]{1,80})/i
    );
    if (nameMatch?.[1]) {
      saved.push(
        await this.saveSharedMemoryValue("profile:name", nameMatch[1].trim())
      );
    }

    return { status: "saved", memories: saved };
  }

  private async autoExtractProfileMemory(
    model: ReturnType<typeof createAgentModel>,
    text: string
  ): Promise<MemoryEntry[]> {
    const cleanText = text.trim();
    if (!cleanText) return [];

    try {
      const result = await generateObject({
        model: model.model,
        providerOptions: model.providerOptions,
        schema: profileMemoryExtractionSchema,
        schemaName: "user_profile_memory",
        schemaDescription:
          "Explicit, durable user profile facts extracted from the latest message.",
        system: `You extract durable personal profile facts from a user's latest message.
Return only facts the user explicitly stated, not guesses or temporary task details.
Save useful facts such as name, email, location, IANA time zone, job-role preferences, work preferences, and recurring goals.
Use these key formats: profile:name, profile:email, profile:location, profile:timezone, profile:preference:<short_name>, profile:goal:<short_name>.
Normalize an explicitly stated time zone to an IANA identifier when possible. Do not save passwords, API keys, tokens, financial data, government IDs, health data, or other secrets.
If there is no durable profile fact, return an empty memories array.`,
        prompt: cleanText,
        abortSignal: undefined
      });

      const extracted = result.object as ProfileMemoryExtraction;
      const saved: MemoryEntry[] = [];
      for (const candidate of extracted.memories) {
        if (
          /password|secret|token|api.?key|access.?token|refresh.?token|oauth|social.?security|passport|credit.?card/i.test(
            `${candidate.key} ${candidate.value}`
          )
        ) {
          continue;
        }

        if (candidate.key === "profile:timezone") {
          const normalizedTimeZone = extractTimeZone(candidate.value);
          if (!normalizedTimeZone) continue;
          saved.push(
            await this.saveSharedMemoryValue(
              "profile:timezone",
              normalizedTimeZone
            )
          );
          continue;
        }

        saved.push(
          await this.saveSharedMemoryValue(candidate.key, candidate.value)
        );
      }
      return saved;
    } catch {
      // Memory extraction must never prevent the main chat response.
      return [];
    }
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
      const refreshToken = getGoogleRefreshToken(request);
      if (refreshToken) await this.persistRefreshToken(refreshToken);
      try {
        const body = await request.json<{ memoryOwnerName?: string }>();
        this.memoryOwnerName = body.memoryOwnerName?.trim() || "";
      } catch {
        this.memoryOwnerName = "";
      }
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
          return successJson({
            memories: this.listMemory(url.searchParams.get("key") || undefined)
          });
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
    const persistedRefreshToken =
      refreshToken || (await this.getPersistedRefreshToken());
    if (!persistedRefreshToken || !config) return null;

    // Refresh only on the server so the browser never sees the Google client secret.
    const tokens = await refreshGoogleAccessToken(
      config,
      persistedRefreshToken
    );
    if (tokens.refresh_token)
      await this.persistRefreshToken(tokens.refresh_token);
    return tokens.access_token;
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const latestUserText = this.latestUserMessageText();
    let agentModel;

    try {
      agentModel = createAgentModel(this.env, this.sessionAffinity);
    } catch (error) {
      const message =
        error instanceof ModelConfigurationError
          ? error.message
          : "The model provider is not configured correctly.";
      return new Response(message, { status: 503 });
    }

    const memorySaveResult = await this.autoSaveExplicitMemory(latestUserText);
    await this.cancelActiveWorkflowForIntentChange(latestUserText);
    const automaticallyExtractedMemories = await this.autoExtractProfileMemory(
      agentModel,
      latestUserText
    );
    const explicitTimeZone = /\b(?:time\s*zone|timezone|tz|preferred)\b/i.test(
      latestUserText
    )
      ? extractTimeZone(latestUserText)
      : null;
    if (explicitTimeZone) {
      await this.saveSharedMemoryValue("profile:timezone", explicitTimeZone);
    }
    const timeZoneMemories = await this.listSharedMemory("profile:timezone");
    const memoryTimeZone = preferredTimeZoneFromMemory(timeZoneMemories);
    const memoryContext = await this.retrieveMemoryContext(latestUserText);
    const memorySaveInstruction =
      memorySaveResult.status === "saved"
        ? `The server saved the explicitly requested memory keys: ${memorySaveResult.memories
            .map((memory) => memory.key)
            .join(
              ", "
            )}. Confirm this briefly without calling the memory tool again.`
        : memorySaveResult.status === "blocked"
          ? memorySaveResult.reason
          : automaticallyExtractedMemories.length > 0
            ? `The server automatically saved these explicit profile facts: ${automaticallyExtractedMemories
                .map((memory) => memory.key)
                .join(
                  ", "
                )}. Mention this naturally only if relevant; do not call the memory tool again.`
            : "No profile memory was extracted for this request.";

    const pendingActions = new PendingActionService(
      this.pendingActionRepository(),
      this.sessionAffinity
    );
    const tools = createToolRegistry({
      env: this.env,
      latestUserText,
      getGoogleAccessToken: () => this.getGmailAccessToken(),
      saveMemory: (key, value) => this.saveSharedMemoryValue(key, value),
      startMeetingWorkflow: (params) => this.startMeetingWorkflow(params),
      pendingActions
    });

    const result = streamText({
      model: agentModel.model,
      providerOptions: agentModel.providerOptions,
      system: buildSystemPrompt({
        now: new Date(),
        timeZone: memoryTimeZone,
        memoryContext,
        memorySaveInstruction
      }),
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools,
      activeTools: selectActiveTools(latestUserText),
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      abortSignal: options?.abortSignal,
      timeout: { totalMs: 60_000 }
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: false,
      onError: safeModelErrorMessage
    });
  }

  async startMeetingWorkflow(params: ScheduleMeetingWorkflowParams) {
    this.ensureWeek3Tables();
    const active = this.sql<{ id: string; workflow_id: string }>`
      SELECT id, workflow_id FROM active_workflows
      WHERE workflow_name = ${"SCHEDULE_MEETING_WORKFLOW"}
      LIMIT 1
    `;
    if (active[0]) {
      await this.terminateWorkflow(active[0].workflow_id).catch(
        () => undefined
      );
      this.sql`DELETE FROM active_workflows WHERE id = ${active[0].id}`;
    }

    const workflowId = await this.runWorkflow(
      "SCHEDULE_MEETING_WORKFLOW",
      params,
      {
        metadata: { memoryOwnerName: this.memoryOwnerName }
      }
    );
    this.sql`
      INSERT OR REPLACE INTO active_workflows (id, workflow_name, workflow_id, created_at)
      VALUES (${"schedule-meeting"}, ${"SCHEDULE_MEETING_WORKFLOW"}, ${workflowId}, ${Date.now()})
    `;
    return workflowId;
  }

  async workflowSearchContact(query: string) {
    const token = await this.getGmailAccessToken();
    if (!token) throw new Error("Google is not connected.");
    const contacts = await searchContacts(token, query, 10);
    if (contacts.length === 0)
      throw new Error(`No contact found for ${query}.`);
    if (contacts.length > 1)
      throw new Error(`Multiple contacts matched ${query}.`);
    const email = contacts[0].emails[0];
    if (!email) throw new Error(`Contact ${query} has no email address.`);
    return { displayName: contacts[0].displayName, email };
  }

  async workflowCheckAvailability(input: {
    startDateTime: string;
    endDateTime: string;
    timeZone: string;
  }) {
    const token = await this.getGmailAccessToken();
    if (!token) throw new Error("Google is not connected.");
    const result = await listCalendarEvents(token, {
      timeMin: new Date(input.startDateTime).toISOString(),
      timeMax: new Date(input.endDateTime).toISOString(),
      timeZone: input.timeZone,
      maxResults: 50
    });
    const start = new Date(input.startDateTime).getTime();
    const end = new Date(input.endDateTime).getTime();
    return result.events.filter((event) => {
      const eventStart = new Date(event.start).getTime();
      const eventEnd = new Date(event.end).getTime();
      return eventStart < end && eventEnd > start;
    });
  }

  async workflowCreateMeeting(input: {
    event: CreateCalendarEventInput;
    conflicts: Array<{ id: string }>;
    overwriteExisting: boolean;
  }) {
    const token = await this.getGmailAccessToken();
    if (!token) throw new Error("Google is not connected.");
    if (input.conflicts.length > 0 && !input.overwriteExisting) {
      throw new Error("The selected time overlaps an existing event.");
    }
    if (input.overwriteExisting) {
      for (const conflict of input.conflicts) {
        if (conflict.id) await deleteCalendarEvent(token, conflict.id);
      }
    }
    return createCalendarEvent(token, input.event);
  }

  async workflowSendNotification(input: {
    to: string;
    subject: string;
    body: string;
  }) {
    const token = await this.getGmailAccessToken();
    if (!token) throw new Error("Google is not connected.");
    return sendGmailMessage(token, input);
  }

  async onWorkflowProgress(
    workflowName: string,
    instanceId: string,
    progress: unknown
  ) {
    this.broadcast(
      JSON.stringify({
        type: "workflow-progress",
        workflowName,
        instanceId,
        progress
      })
    );
  }

  async onWorkflowComplete(
    workflowName: string,
    instanceId: string,
    result?: unknown
  ) {
    this.sql`DELETE FROM active_workflows WHERE workflow_id = ${instanceId}`;
    this.broadcast(
      JSON.stringify({
        type: "workflow-complete",
        workflowName,
        instanceId,
        result
      })
    );
  }

  async onWorkflowError(
    workflowName: string,
    instanceId: string,
    error: unknown
  ) {
    this.sql`DELETE FROM active_workflows WHERE workflow_id = ${instanceId}`;
    this.broadcast(
      JSON.stringify({
        type: "workflow-error",
        workflowName,
        instanceId,
        error
      })
    );
  }
}

export { ScheduleMeetingWorkflow } from "./workflows/scheduleMeeting";

export default {
  async fetch(request: Request, env: Env) {
    const canonicalRedirect = redirectToCanonicalUrl(request);
    if (canonicalRedirect) return canonicalRedirect;

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
      let memoryOwnerName = agentName.split(":")[0] || "";
      try {
        const body = await request.clone().json<{ memoryOwnerName?: string }>();
        memoryOwnerName = body.memoryOwnerName?.trim() || memoryOwnerName;
      } catch {
        // The agent name contains the local user id as a fallback.
      }

      return agent.fetch(
        new Request(syncUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: request.headers.get("Cookie") || "",
            "X-WorkingHelper-Internal": "auth-sync"
          },
          body: JSON.stringify({ memoryOwnerName })
        })
      );
    }

    const googleResponse = await handleGoogleRoutes(request, env);
    if (googleResponse) return googleResponse;

    const week3Response = await handleWeek3Routes(request, env);
    if (week3Response) return week3Response;

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
      return new Response("Not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
