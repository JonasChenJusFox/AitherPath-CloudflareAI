import { ApiError } from "../utils/api";
import { PendingActionError } from "./pendingActions";
import { toolFailure, type ToolResult } from "./types";

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
          "Google is not connected. Connect Gmail before using this tool."
        );
      }

      if (error.code === "REAUTHORIZATION_REQUIRED") {
        return toolFailure(
          "REAUTHORIZATION_REQUIRED",
          "Google authorization expired. Please connect Google again."
        );
      }

      if (error.code === "VALIDATION_ERROR") {
        return toolFailure("VALIDATION_ERROR", error.message);
      }
    }

    return toolFailure("PROVIDER_ERROR", fallbackMessage, true);
  }
}
