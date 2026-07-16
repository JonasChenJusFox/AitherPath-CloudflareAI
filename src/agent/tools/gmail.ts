import { tool } from "ai";
import { z } from "zod";
import { listInboxMessages, sendGmailMessage } from "../../google/gmail";
import { ApiError } from "../../utils/api";
import { safeToolExecution } from "../toolErrors";
import type { AgentToolContext } from "../types";

export const listGmailInboxToolSchema = z
  .object({
    maxResults: z.number().int().min(1).max(10).optional()
  })
  .strict();

export const sendGmailEmailToolSchema = z
  .object({
    to: z.email().trim().max(254).describe("Verified recipient email address."),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20_000)
  })
  .strict();

async function requireGoogleToken(context: AgentToolContext) {
  const token = await context.getGoogleAccessToken();
  if (!token) {
    throw new ApiError(
      "AUTHENTICATION_REQUIRED",
      "Google is not connected.",
      401
    );
  }
  return token;
}

export function createGmailTools(context: AgentToolContext) {
  return {
    listGmailInbox: tool({
      description:
        "Read up to 10 recent messages from the connected Gmail inbox when the user asks to check, read, or summarize mail. Do not use it to send, draft, or modify email. This is read-only. If Google is not connected, ask the user to connect Gmail.",
      inputSchema: listGmailInboxToolSchema,
      execute: async ({ maxResults }) =>
        safeToolExecution(
          async () => ({
            messages: await listInboxMessages(
              await requireGoogleToken(context),
              maxResults ?? 5
            )
          }),
          "Gmail could not be read. Please reconnect Google or try again."
        )
    }),

    sendGmailEmail: tool({
      description:
        "Send one plain-text Gmail message only after the user has supplied a verified recipient address, a non-empty subject, and the complete body. Do not use this tool merely to draft an email. This changes external state and always requires the approval preview shown by the UI. Never invent an address or claim success unless Gmail returns a message ID.",
      inputSchema: sendGmailEmailToolSchema,
      needsApproval: true,
      metadata: { sideEffect: true, confirmation: "required" },
      onInputAvailable: ({ input, toolCallId }) => {
        context.pendingActions.prepare(toolCallId, "sendGmailEmail", input, {
          title: "Send email",
          recipient: input.to,
          subject: input.subject,
          body: input.body
        });
      },
      execute: async (input, { toolCallId }) =>
        safeToolExecution(
          () =>
            context.pendingActions.executeOnce(
              toolCallId,
              "sendGmailEmail",
              input,
              async () => {
                const result = await sendGmailMessage(
                  await requireGoogleToken(context),
                  input
                );
                return {
                  sent: true,
                  messageId: result.id,
                  threadId: result.threadId
                };
              }
            ),
          "Gmail did not send the message. It is safe to review the action and try again."
        )
    })
  };
}
