import { tool } from "ai";
import { z } from "zod";
import { timeZoneSchema } from "../time";
import type { AgentToolContext } from "../types";

export const scheduleMeetingWorkflowToolSchema = z
  .object({
    contactQuery: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(160),
    startDateTime: z.string().datetime({ offset: true }),
    endDateTime: z.string().datetime({ offset: true }),
    timeZone: timeZoneSchema,
    description: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(300).optional(),
    overwriteExisting: z.boolean().optional().default(false),
    sendNotification: z.boolean().optional().default(true)
  })
  .strict()
  .superRefine((input, context) => {
    if (new Date(input.endDateTime) <= new Date(input.startDateTime)) {
      context.addIssue({
        code: "custom",
        path: ["endDateTime"],
        message: "Event end time must be after its start time."
      });
    }
  });

export function createWorkflowTools(context: AgentToolContext) {
  return {
    scheduleMeetingWorkflow: tool({
      description:
        "Start a durable multi-step meeting workflow only when the user supplied a specific contact, exact start/end time, title, and time zone. The workflow searches Google Contacts, checks Calendar availability, creates the approved event, and sends an invitation notification. Every external step has automatic retries. If the slot is busy, do not set overwriteExisting unless the user explicitly confirmed overwriting.",
      inputSchema: scheduleMeetingWorkflowToolSchema,
      needsApproval: true,
      metadata: { sideEffect: true, confirmation: "required" },
      execute: async (input) => {
        if (!context.startMeetingWorkflow) {
          return {
            started: false,
            message: "The workflow service is not configured."
          };
        }
        return {
          started: true,
          workflowId: await context.startMeetingWorkflow(input),
          message:
            "The durable meeting workflow has started. It will report progress and retry transient failures automatically."
        };
      }
    })
  };
}
