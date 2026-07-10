import { z } from "zod";

const timeZoneSchema = z.string().trim().min(1).max(80).default("UTC");
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const listTodayEventsSchema = z.object({
  timeZone: timeZoneSchema,
  maxResults: z.coerce.number().int().min(1).max(20).optional()
});

export const listEventsSchema = z.object({
  timeMin: z.string().datetime(),
  timeMax: z.string().datetime(),
  timeZone: timeZoneSchema,
  maxResults: z.coerce.number().int().min(1).max(50).optional(),
  pageToken: z.string().trim().min(1).max(512).optional()
});

export const createEventSchema = z.object({
  summary: boundedText(160),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(300).optional(),
  startDateTime: z.string().datetime({ offset: true }),
  endDateTime: z.string().datetime({ offset: true }),
  timeZone: timeZoneSchema,
  attendeeEmails: z.array(z.email()).max(20).optional(),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).optional()
});

export const contactsSearchSchema = z.object({
  q: boundedText(120),
  pageSize: z.coerce.number().int().min(1).max(20).default(10)
});

export const preferencesPatchSchema = z.object({
  timeZone: timeZoneSchema.optional(),
  defaultMeetingDurationMinutes: z.number().int().min(5).max(480).optional(),
  defaultCalendarId: z.string().trim().min(1).max(240).optional()
});

export const memoryPostSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9:_-]{1,80}$/),
  value: z.string().trim().min(1).max(2000)
});

export function parseSearchParams<T extends z.ZodType>(
  schema: T,
  url: URL
): z.infer<T> {
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

export async function parseJsonBody<T extends z.ZodType>(
  schema: T,
  request: Request
): Promise<z.infer<T>> {
  return schema.parse(await request.json());
}
