import type { PendingActionService } from "./pendingActions";

export type ToolErrorCode =
  | "CONFIGURATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "REAUTHORIZATION_REQUIRED"
  | "VALIDATION_ERROR"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_MISMATCH"
  | "ALREADY_EXECUTED";

export type ToolResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ToolErrorCode;
        message: string;
        retryable: boolean;
      };
    };

export type MemoryEntry = {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
};

export type AgentToolContext = {
  env: Env;
  latestUserText: string;
  getGoogleAccessToken: () => Promise<string | null>;
  saveMemory: (key: string, value: string) => Promise<MemoryEntry>;
  pendingActions: PendingActionService;
};

export function toolSuccess<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

export function toolFailure(
  code: ToolErrorCode,
  message: string,
  retryable = false
): ToolResult<never> {
  return { ok: false, error: { code, message, retryable } };
}
