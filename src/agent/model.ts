import { createOpenAI } from "@ai-sdk/openai";
import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
export type LlmProvider = "openai" | "workers-ai";

export class ModelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigurationError";
  }
}

export type AgentModel = {
  model: LanguageModel;
  provider: LlmProvider;
  modelId: string;
  providerOptions?: ProviderOptions;
};

export function getLlmProvider(env: Env): LlmProvider {
  const provider = (env.LLM_PROVIDER || "openai").trim().toLowerCase();
  if (provider === "openai" || provider === "workers-ai") return provider;
  throw new ModelConfigurationError(
    "LLM_PROVIDER must be either openai or workers-ai."
  );
}

export function createAgentModel(
  env: Env,
  sessionAffinity?: string
): AgentModel {
  const provider = getLlmProvider(env);

  if (provider === "workers-ai") {
    const workersAI = createWorkersAI({ binding: env.AI });
    const modelId = "@cf/moonshotai/kimi-k2.6";
    return {
      provider,
      modelId,
      model: workersAI(modelId, { sessionAffinity })
    };
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ModelConfigurationError(
      "OpenAI is not configured. Add OPENAI_API_KEY as a Cloudflare secret."
    );
  }

  const modelId = env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const openai = createOpenAI({ apiKey });
  return {
    provider,
    modelId,
    model: openai.responses(modelId),
    providerOptions: {
      openai: {
        store: false,
        parallelToolCalls: false
      }
    }
  };
}

export function safeModelErrorMessage(error: unknown) {
  const statusCode =
    typeof error === "object" && error && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0;

  if (statusCode === 401 || statusCode === 403) {
    return "OpenAI authentication failed. Check the configured API key and project access.";
  }
  if (statusCode === 429) {
    return "The model provider is rate limited. Please try again shortly.";
  }
  if (statusCode === 408 || statusCode === 504) {
    return "The model provider timed out. Please try again.";
  }
  return "The model provider could not complete this request. Please try again.";
}
