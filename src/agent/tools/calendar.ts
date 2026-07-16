import { tool } from "ai";
import { z } from "zod";
import {
  createCalendarEvent,
  listCalendarEventsForDate,
  listTodayCalendarEvents
} from "../../google/calendar";
import { ApiError } from "../../utils/api";
import { safeToolExecution } from "../toolErrors";
import { timeZoneSchema } from "../time";
import type { AgentToolContext } from "../types";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.");

export const listTodayCalendarToolSchema = z
  .object({
    timeZone: timeZoneSchema,
    maxResults: z.number().int().min(1).max(10).optional()
  })
  .strict();

export const listCalendarByDateToolSchema = z
  .object({
    date: calendarDateSchema,
    timeZone: timeZoneSchema,
    maxResults: z.number().int().min(1).max(20).optional()
  })
  .strict();

export const createCalendarEventToolSchema = z
  .object({
    summary: z.string().trim().min(1).max(160),
    startDateTime: z.string().datetime({ offset: true }),
    endDateTime: z.string().datetime({ offset: true }),
    timeZone: timeZoneSchema,
    description: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(300).optional(),
    attendeeEmails: z.array(z.email().trim().max(254)).max(20).optional()
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

export function createCalendarTools(context: AgentToolContext) {
  return {
    listTodayCalendarEvents: tool({
      description:
        "Read today's Google Calendar events when the user asks about today's schedule, meetings, events, or classes. Use the saved user time zone when available. This is read-only. Ask for a time zone if it is unknown.",
      inputSchema: listTodayCalendarToolSchema,
      execute: async ({ timeZone, maxResults }) =>
        safeToolExecution(
          async () => ({
            timeZone,
            events: await listTodayCalendarEvents(
              await requireGoogleToken(context),
              timeZone,
              maxResults ?? 10
            )
          }),
          "Google Calendar could not be read. Please reconnect Google or try again."
        )
    }),

    listCalendarEventsByDate: tool({
      description:
        "Read Google Calendar events for one resolved YYYY-MM-DD date, including tomorrow or another relative date. Resolve relative dates in the user's time zone before calling. Do not use ambiguous numeric dates. This is read-only.",
      inputSchema: listCalendarByDateToolSchema,
      execute: async ({ date, timeZone, maxResults }) =>
        safeToolExecution(
          async () => ({
            date,
            timeZone,
            events: await listCalendarEventsForDate(
              await requireGoogleToken(context),
              date,
              timeZone,
              maxResults ?? 10
            )
          }),
          "Google Calendar could not be read. Please reconnect Google or try again."
        )
    }),

    createCalendarEvent: tool({
      description:
        "Create one Google Calendar event only after title, RFC3339 start and end timestamps with offsets, and an IANA time zone are known. End must be after start. This changes external state and always requires the approval preview shown by the UI. Include the resolved date, time, time zone, attendees, and location in the preview. Never claim success unless Google returns the created event.",
      inputSchema: createCalendarEventToolSchema,
      needsApproval: true,
      metadata: { sideEffect: true, confirmation: "required" },
      onInputAvailable: ({ input, toolCallId }) => {
        context.pendingActions.prepare(
          toolCallId,
          "createCalendarEvent",
          input,
          {
            title: "Create calendar event",
            summary: input.summary,
            startDateTime: input.startDateTime,
            endDateTime: input.endDateTime,
            timeZone: input.timeZone,
            location: input.location || null,
            attendeeEmails: input.attendeeEmails || []
          }
        );
      },
      execute: async (input, { toolCallId }) =>
        safeToolExecution(
          () =>
            context.pendingActions.executeOnce(
              toolCallId,
              "createCalendarEvent",
              input,
              async () => ({
                created: true,
                event: await createCalendarEvent(
                  await requireGoogleToken(context),
                  { ...input, sendUpdates: "none" }
                )
              })
            ),
          "Google Calendar did not create the event. It is safe to review the action and try again."
        )
    })
  };
}
