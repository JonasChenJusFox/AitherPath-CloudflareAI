import { ApiError } from "../utils/api";
import { PendingActionError } from "./pendingActions";
import { toolFailure, type ToolResult } from "./types";

function readableError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.detail;
    if (typeof message === "string" && message.trim()) return message;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore non-serializable provider errors.
    }
  }
  return fallback;
}

export async function safeToolExecution<T>(
  operation: () => Promise<T>,
  fallbackMessage: string
): Promise<ToolResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof PendingActionError) {
      return toolFailure(error.code, error.message);
    }

    if (error instanceof ApiError) {
      if (error.code === "AUTHENTICATION_REQUIRED") {
        return toolFailure(
          "AUTHENTICATION_REQUIRED",
          "Google is not connected. Log in with Google before using this tool."
        );
      }

      if (error.code === "REAUTHORIZATION_REQUIRED") {
        return toolFailure(
          "REAUTHORIZATION_REQUIRED",
          "Google authorization expired. Please log in again."
        );
      }

      if (error.code === "VALIDATION_ERROR") {
        return toolFailure("VALIDATION_ERROR", error.message);
      }

      if (error.code === "JOB_SEARCH_ERROR") {
        return toolFailure("PROVIDER_ERROR", error.message, true);
      }
    }

    return toolFailure(
      "PROVIDER_ERROR",
      readableError(error, fallbackMessage),
      true
    );
  }
}
