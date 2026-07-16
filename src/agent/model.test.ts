import { describe, expect, it } from "vitest";
import {
  createAgentModel,
  DEFAULT_OPENAI_MODEL,
  getLlmProvider,
  ModelConfigurationError,
  safeModelErrorMessage
} from "./model";

function env(values: Record<string, unknown> = {}) {
  return values as unknown as Env;
}

describe("model provider configuration", () => {
  it("uses OpenAI by default and requires a server-side API key", () => {
    expect(getLlmProvider(env())).toBe("openai");
    expect(() => createAgentModel(env())).toThrow(ModelConfigurationError);
    expect(() => createAgentModel(env())).toThrow("OPENAI_API_KEY");
  });

  it("reads the OpenAI model from environment configuration", () => {
    const configured = createAgentModel(
      env({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-5.4-mini" })
    );
    expect(configured.provider).toBe("openai");
    expect(configured.modelId).toBe("gpt-5.4-mini");
  });

  it("uses a documented code-level model default", () => {
    const configured = createAgentModel(env({ OPENAI_API_KEY: "test-key" }));
    expect(configured.modelId).toBe(DEFAULT_OPENAI_MODEL);
  });

  it("retains the explicit Workers AI fallback", () => {
    const configured = createAgentModel(
      env({ LLM_PROVIDER: "workers-ai", AI: {} as Ai }),
      "session"
    );
    expect(configured.provider).toBe("workers-ai");
    expect(configured.modelId).toBe("@cf/moonshotai/kimi-k2.6");
  });

  it("never includes provider secrets in safe errors", () => {
    const message = safeModelErrorMessage({
      statusCode: 401,
      message: "bad sk-test-secret"
    });
    expect(message).toContain("authentication failed");
    expect(message).not.toContain("sk-test-secret");
  });
});
