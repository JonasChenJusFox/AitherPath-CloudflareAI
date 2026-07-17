import { tool } from "ai";
import { z } from "zod";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
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

export const checkCalendarAvailabilityToolSchema = z
  .object({
    startDateTime: z.string().datetime({ offset: true }),
    endDateTime: z.string().datetime({ offset: true }),
    timeZone: timeZoneSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (new Date(input.endDateTime) <= new Date(input.startDateTime)) {
      context.addIssue({
        code: "custom",
        path: ["endDateTime"],
        message: "Availability end time must be after its start time."
      });
    }
  });

export const createCalendarEventToolSchema = z
  .object({
    summary: z.string().trim().min(1).max(160),
    startDateTime: z.string().datetime({ offset: true }),
    endDateTime: z.string().datetime({ offset: true }),
    timeZone: timeZoneSchema,
    description: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(300).optional(),
    attendeeEmails: z.array(z.email().trim().max(254)).max(20).optional(),
    overwriteExisting: z.boolean().optional().default(false)
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

async function findConflictingEvents(
  accessToken: string,
  input: {
    startDateTime: string;
    endDateTime: string;
    timeZone: string;
  }
) {
  const start = new Date(input.startDateTime).getTime();
  const end = new Date(input.endDateTime).getTime();
  const result = await listCalendarEvents(accessToken, {
    timeMin: new Date(start).toISOString(),
    timeMax: new Date(end).toISOString(),
    timeZone: input.timeZone,
    maxResults: 50
  });

  return result.events.filter((event) => {
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();
    return (
      Number.isFinite(eventStart) &&
      Number.isFinite(eventEnd) &&
      eventStart < end &&
      eventEnd > start
    );
  });
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

    checkCalendarAvailability: tool({
      description:
        "Check whether a proposed calendar interval is free. Always call this before proposing or creating an event at a specific time. Return any overlapping events. If the interval is busy, ask the user whether to overwrite the existing event before calling createCalendarEvent.",
      inputSchema: checkCalendarAvailabilityToolSchema,
      execute: async (input) =>
        safeToolExecution(async () => {
          const conflicts = await findConflictingEvents(
            await requireGoogleToken(context),
            input
          );
          return {
            available: conflicts.length === 0,
            conflicts,
            startDateTime: input.startDateTime,
            endDateTime: input.endDateTime,
            timeZone: input.timeZone
          };
        }, "Google Calendar availability could not be checked. Please reconnect Google or try again.")
    }),

    createCalendarEvent: tool({
      description:
        "Create one Google Calendar event only after title, RFC3339 start and end timestamps with offsets, and an IANA time zone are known. Check availability first. If the chosen interval overlaps an existing event, ask the user whether to overwrite it; set overwriteExisting only after an explicit yes. This changes external state and always requires the approval preview shown by the UI. Never claim success unless Google returns the created event.",
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
            attendeeEmails: input.attendeeEmails || [],
            overwriteExisting: input.overwriteExisting
          }
        );
      },
      execute: async (input, { toolCallId }) =>
        safeToolExecution(async () => {
          const accessToken = await requireGoogleToken(context);
          const conflicts = await findConflictingEvents(accessToken, input);
          if (conflicts.length > 0 && !input.overwriteExisting) {
            throw new ApiError(
              "VALIDATION_ERROR",
              "The selected time overlaps existing calendar events. Ask the user whether to overwrite them before trying again.",
              400
            );
          }

          return context.pendingActions.executeOnce(
            toolCallId,
            "createCalendarEvent",
            input,
            async () => {
              const deleted = input.overwriteExisting
                ? await Promise.all(
                    conflicts.map((event) =>
                      deleteCalendarEvent(accessToken, event.id)
                    )
                  )
                : [];
              return {
                created: true,
                overwrittenEvents: deleted,
                event: await createCalendarEvent(accessToken, {
                  ...input,
                  sendUpdates: "none"
                })
              };
            }
          );
        }, "Google Calendar did not create the event. It is safe to review the action and try again.")
    })
  };
}
