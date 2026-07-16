import { describe, expect, it, vi } from "vitest";
import {
  PendingActionError,
  PendingActionService,
  type PendingAction,
  type PendingActionRepository,
  type PendingActionStatus,
  type PendingActionToolName
} from "./pendingActions";

class MemoryPendingActionRepository implements PendingActionRepository {
  readonly actions = new Map<string, PendingAction>();

  insertIfAbsent(action: PendingAction) {
    if (!this.actions.has(action.id)) this.actions.set(action.id, action);
  }

  get(id: string) {
    return this.actions.get(id) || null;
  }

  cancelPendingForTool(toolName: PendingActionToolName, exceptId: string) {
    for (const action of this.actions.values()) {
      if (
        action.toolName === toolName &&
        action.id !== exceptId &&
        action.status === "pending"
      ) {
        action.status = "cancelled";
      }
    }
  }

  transition(id: string, from: PendingActionStatus, to: PendingActionStatus) {
    const action = this.actions.get(id);
    if (!action || action.status !== from) return false;
    action.status = to;
    return true;
  }
}

const email = {
  to: "person@example.com",
  subject: "Interview",
  body: "Can we meet tomorrow?"
};

describe("pending side-effect confirmation", () => {
  it("does not execute an email while only preparing its preview", () => {
    const repository = new MemoryPendingActionRepository();
    const service = new PendingActionService(
      repository,
      "session-a",
      () => 1000
    );
    const send = vi.fn();

    service.prepare("call-1", "sendGmailEmail", email, email);

    expect(send).not.toHaveBeenCalled();
    expect(repository.get("call-1")?.status).toBe("pending");
  });

  it("executes a matching approved action exactly once", async () => {
    const repository = new MemoryPendingActionRepository();
    const service = new PendingActionService(
      repository,
      "session-a",
      () => 1000
    );
    const send = vi.fn(async () => ({ id: "message-1" }));
    service.prepare("call-1", "sendGmailEmail", email, email);

    await expect(
      service.executeOnce("call-1", "sendGmailEmail", email, send)
    ).resolves.toEqual({ id: "message-1" });
    await expect(
      service.executeOnce("call-1", "sendGmailEmail", email, send)
    ).rejects.toMatchObject({ code: "ALREADY_EXECUTED" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("invalidates an older preview when arguments change", async () => {
    const repository = new MemoryPendingActionRepository();
    const service = new PendingActionService(
      repository,
      "session-a",
      () => 1000
    );
    service.prepare("call-1", "sendGmailEmail", email, email);
    service.prepare(
      "call-2",
      "sendGmailEmail",
      { ...email, subject: "Updated" },
      { ...email, subject: "Updated" }
    );

    expect(repository.get("call-1")?.status).toBe("cancelled");
    await expect(
      service.executeOnce("call-2", "sendGmailEmail", email, async () => true)
    ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
  });

  it("rejects expired confirmations", async () => {
    let now = 1000;
    const repository = new MemoryPendingActionRepository();
    const service = new PendingActionService(
      repository,
      "session-a",
      () => now
    );
    service.prepare("call-1", "sendGmailEmail", email, email);
    now += 11 * 60 * 1000;

    await expect(
      service.executeOnce("call-1", "sendGmailEmail", email, async () => true)
    ).rejects.toMatchObject({ code: "CONFIRMATION_EXPIRED" });
  });

  it("prevents one session from confirming another session's action", async () => {
    const repository = new MemoryPendingActionRepository();
    const first = new PendingActionService(repository, "session-a", () => 1000);
    const second = new PendingActionService(
      repository,
      "session-b",
      () => 1000
    );
    first.prepare("call-1", "sendGmailEmail", email, email);

    await expect(
      second.executeOnce("call-1", "sendGmailEmail", email, async () => true)
    ).rejects.toBeInstanceOf(PendingActionError);
  });
});
