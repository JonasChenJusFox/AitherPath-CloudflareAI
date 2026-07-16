export const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

export type PendingActionToolName = "sendGmailEmail" | "createCalendarEvent";

export type PendingActionStatus =
  | "pending"
  | "executing"
  | "executed"
  | "cancelled";

export type PendingAction = {
  id: string;
  sessionId: string;
  toolName: PendingActionToolName;
  normalizedArguments: string;
  preview: string;
  createdAt: number;
  expiresAt: number;
  status: PendingActionStatus;
};

export interface PendingActionRepository {
  insertIfAbsent(action: PendingAction): void;
  get(id: string): PendingAction | null;
  cancelPendingForTool(toolName: PendingActionToolName, exceptId: string): void;
  transition(
    id: string,
    from: PendingActionStatus,
    to: PendingActionStatus
  ): boolean;
}

export class PendingActionError extends Error {
  constructor(
    readonly code:
      | "CONFIRMATION_EXPIRED"
      | "CONFIRMATION_MISMATCH"
      | "ALREADY_EXECUTED",
    message: string
  ) {
    super(message);
    this.name = "PendingActionError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

export function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export class PendingActionService {
  constructor(
    private readonly repository: PendingActionRepository,
    private readonly sessionId: string,
    private readonly now: () => number = Date.now
  ) {}

  prepare(
    id: string,
    toolName: PendingActionToolName,
    normalizedArguments: unknown,
    preview: unknown
  ) {
    const createdAt = this.now();
    this.repository.cancelPendingForTool(toolName, id);
    this.repository.insertIfAbsent({
      id,
      sessionId: this.sessionId,
      toolName,
      normalizedArguments: stableJson(normalizedArguments),
      preview: stableJson(preview),
      createdAt,
      expiresAt: createdAt + PENDING_ACTION_TTL_MS,
      status: "pending"
    });
  }

  async executeOnce<T>(
    id: string,
    toolName: PendingActionToolName,
    normalizedArguments: unknown,
    operation: () => Promise<T>
  ): Promise<T> {
    const action = this.repository.get(id);
    if (
      !action ||
      action.sessionId !== this.sessionId ||
      action.toolName !== toolName ||
      action.normalizedArguments !== stableJson(normalizedArguments)
    ) {
      throw new PendingActionError(
        "CONFIRMATION_MISMATCH",
        "This confirmation does not match the pending action. Review the latest preview and try again."
      );
    }

    if (action.expiresAt <= this.now()) {
      this.repository.transition(id, "pending", "cancelled");
      throw new PendingActionError(
        "CONFIRMATION_EXPIRED",
        "This confirmation expired. Ask the assistant to prepare the action again."
      );
    }

    if (action.status !== "pending") {
      throw new PendingActionError(
        "ALREADY_EXECUTED",
        "This action was already handled and will not be executed again."
      );
    }

    if (!this.repository.transition(id, "pending", "executing")) {
      throw new PendingActionError(
        "ALREADY_EXECUTED",
        "This action was already handled and will not be executed again."
      );
    }

    try {
      const result = await operation();
      this.repository.transition(id, "executing", "executed");
      return result;
    } catch (error) {
      this.repository.transition(id, "executing", "cancelled");
      throw error;
    }
  }
}
