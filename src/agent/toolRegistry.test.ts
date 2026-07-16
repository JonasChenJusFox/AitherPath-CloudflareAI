import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { MockLanguageModelV3, mockValues } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import {
  PendingActionService,
  type PendingActionRepository
} from "./pendingActions";
import { createToolRegistry } from "./toolRegistry";
import { MAX_TOOL_STEPS } from "./orchestration";

const unusedPendingRepository: PendingActionRepository = {
  insertIfAbsent: () => undefined,
  get: () => null,
  cancelPendingForTool: () => undefined,
  transition: () => false
};

function createContext(overrides: Partial<Env> = {}) {
  return {
    env: overrides as Env,
    latestUserText: "",
    getGoogleAccessToken: async () => null,
    saveMemory: async (key: string, value: string) => ({
      key,
      value,
      createdAt: 1,
      updatedAt: 1
    }),
    pendingActions: new PendingActionService(
      unusedPendingRepository,
      "test-session"
    )
  };
}

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("typed tool registry", () => {
  it("requires server-side approval for both external write tools", () => {
    const tools = createToolRegistry(createContext());
    expect(tools.sendGmailEmail.needsApproval).toBe(true);
    expect(tools.createCalendarEvent.needsApproval).toBe(true);
  });

  it("returns a structured Google connection error", async () => {
    const tools = createToolRegistry(createContext());
    const output = await tools.listGmailInbox.execute!(
      { maxResults: 5 },
      { toolCallId: "call-1", messages: [] }
    );

    expect(output).toMatchObject({
      ok: false,
      error: { code: "AUTHENTICATION_REQUIRED" }
    });
  });

  it("executes a selected job tool and returns normalized results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          jobs: [
            {
              title: "Software Engineer Intern",
              company: "Example",
              location: "New York",
              link: "https://example.com/job"
            }
          ]
        })
      )
    );
    const tools = createToolRegistry(
      createContext({ JOOBLE_API_KEY: "test-jooble-key" })
    );
    const output = await tools.searchJobs.execute!(
      { keywords: "software engineering internship", location: "New York" },
      { toolCallId: "call-1", messages: [] }
    );

    expect(output).toMatchObject({
      ok: true,
      data: {
        jobs: [{ title: "Software Engineer Intern", company: "Example" }]
      }
    });
  });

  it("feeds a tool result back into the bounded model loop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          jobs: [
            {
              title: "Frontend Engineer",
              company: "Example",
              location: "Remote",
              link: "https://example.com/frontend"
            }
          ]
        })
      )
    );
    const nextResponse = mockValues<LanguageModelV3GenerateResult>(
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "searchJobs",
            input: JSON.stringify({
              keywords: "frontend engineer",
              location: "Remote"
            })
          }
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: []
      },
      {
        content: [{ type: "text", text: "I found a frontend role." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: []
      }
    );
    const model = new MockLanguageModelV3({
      doGenerate: async () => nextResponse()
    });

    const result = await generateText({
      model,
      tools: createToolRegistry(
        createContext({ JOOBLE_API_KEY: "test-jooble-key" })
      ),
      activeTools: ["searchJobs"],
      stopWhen: stepCountIs(3),
      prompt: "Find frontend engineer jobs"
    });

    expect(result.text).toBe("I found a frontend role.");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain(
      "Frontend Engineer"
    );
  });

  it("stops a repeating tool loop at the configured step limit", async () => {
    let callNumber = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callNumber += 1;
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `repeat-${callNumber}`,
              toolName: "repeat",
              input: "{}"
            }
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: []
        };
      }
    });

    await generateText({
      model,
      tools: {
        repeat: tool({
          inputSchema: z.object({}).strict(),
          execute: async () => ({ ok: true })
        })
      },
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      prompt: "Repeat forever"
    });

    expect(model.doGenerateCalls).toHaveLength(MAX_TOOL_STEPS);
  });
});
