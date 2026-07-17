import { ApiError } from "../utils/api";

const CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type CalendarEventSummary = {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  htmlLink: string;
};

export type ListEventsInput = {
  timeMin: string;
  timeMax: string;
  timeZone: string;
  maxResults?: number;
  pageToken?: string;
};

export type CreateCalendarEventInput = {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  attendeeEmails?: string[];
  sendUpdates?: "all" | "externalOnly" | "none";
};

type GoogleEventDate = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventDate;
  end?: GoogleEventDate;
};

type GoogleEventsResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
};

type GoogleApiErrorResponse = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{
      reason?: string;
      message?: string;
    }>;
  };
};

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`
  };
}

function normalizeEvent(event: GoogleCalendarEvent): CalendarEventSummary {
  return {
    id: event.id || "",
    summary: event.summary || "(No title)",
    description: event.description || "",
    location: event.location || "",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    htmlLink: event.htmlLink || ""
  };
}

async function calendarFetch<T>(
  accessToken: string,
  url: string,
  init?: RequestInit
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(accessToken),
      ...init?.headers
    }
  });

  if (!response.ok) {
    const details = await readGoogleApiError(response);
    throw new ApiError(
      details.code,
      details.message,
      response.status === 401 ? 401 : response.status
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json<T>();
}

async function readGoogleApiError(response: Response) {
  let googleError: GoogleApiErrorResponse | null = null;

  try {
    googleError = (await response.json()) as GoogleApiErrorResponse;
  } catch {
    // Google usually returns JSON errors, but keep a useful fallback for rare HTML/text responses.
  }

  const reasons = googleError?.error?.errors
    ?.map((error) => error.reason)
    .filter(Boolean);
  const reasonText = reasons?.join(", ") || googleError?.error?.status || "";
  const googleMessage = googleError?.error?.message || "";
  const combined = `${reasonText} ${googleMessage}`.toLowerCase();

  if (response.status === 401) {
    return {
      code: "REAUTHORIZATION_REQUIRED" as const,
      message: "Google authorization expired. Please connect Google again."
    };
  }

  if (
    combined.includes("insufficient") ||
    combined.includes("permission") ||
    combined.includes("scope")
  ) {
    return {
      code: "REAUTHORIZATION_REQUIRED" as const,
      message:
        "Google Calendar permission is missing. Click Switch Gmail and approve Calendar access again."
    };
  }

  if (
    combined.includes("api has not been used") ||
    combined.includes("access not configured") ||
    combined.includes("disabled")
  ) {
    return {
      code: "CALENDAR_API_ERROR" as const,
      message:
        "Google Calendar API is not enabled for this Google Cloud project. Enable Google Calendar API, then try again."
    };
  }

  return {
    code: "CALENDAR_API_ERROR" as const,
    message: googleMessage
      ? `Google Calendar error: ${googleMessage}`
      : "Unable to communicate with Google Calendar."
  };
}

function assertTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Invalid time zone.", 400);
  }
}

function partsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second"))
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = partsInTimeZone(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
}

function zonedDateTimeToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - getTimeZoneOffsetMs(new Date(guess), timeZone);
  const corrected = guess - getTimeZoneOffsetMs(new Date(first), timeZone);
  return new Date(corrected).toISOString();
}

export function getTodayBounds(timeZone: string, now = new Date()) {
  assertTimeZone(timeZone);
  const parts = partsInTimeZone(now, timeZone);
  return getDateBounds(
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    timeZone
  );
}

export function getDateBounds(date: string, timeZone: string) {
  assertTimeZone(timeZone);
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Date must use YYYY-MM-DD format.",
      400
    );
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
  const start = zonedDateTimeToUtcIso(
    parts.year,
    parts.month,
    parts.day,
    0,
    0,
    0,
    timeZone
  );
  const end = zonedDateTimeToUtcIso(
    parts.year,
    parts.month,
    parts.day + 1,
    0,
    0,
    0,
    timeZone
  );
  return { timeMin: start, timeMax: end };
}

export async function listCalendarEvents(
  accessToken: string,
  input: ListEventsInput
) {
  assertTimeZone(input.timeZone);
  const url = new URL(CALENDAR_EVENTS_URL);
  url.searchParams.set("timeMin", input.timeMin);
  url.searchParams.set("timeMax", input.timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeZone", input.timeZone);
  if (input.maxResults)
    url.searchParams.set("maxResults", String(input.maxResults));
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);

  const data = await calendarFetch<GoogleEventsResponse>(
    accessToken,
    url.toString()
  );

  return {
    events: (data.items || []).map(normalizeEvent),
    nextPageToken: data.nextPageToken || null
  };
}

export async function listTodayCalendarEvents(
  accessToken: string,
  timeZone: string,
  maxResults?: number
) {
  const bounds = getTodayBounds(timeZone);
  return listCalendarEvents(accessToken, {
    ...bounds,
    timeZone,
    maxResults
  });
}

export async function listCalendarEventsForDate(
  accessToken: string,
  date: string,
  timeZone: string,
  maxResults?: number
) {
  const bounds = getDateBounds(date, timeZone);
  return listCalendarEvents(accessToken, {
    ...bounds,
    timeZone,
    maxResults
  });
}

export async function createCalendarEvent(
  accessToken: string,
  input: CreateCalendarEventInput
) {
  assertTimeZone(input.timeZone);
  const start = new Date(input.startDateTime);
  const end = new Date(input.endDateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Invalid event start or end time.",
      400
    );
  }
  if (end <= start) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Event end time must be after start time.",
      400
    );
  }

  const url = new URL(CALENDAR_EVENTS_URL);
  if (input.sendUpdates) url.searchParams.set("sendUpdates", input.sendUpdates);

  const event = await calendarFetch<GoogleCalendarEvent>(
    accessToken,
    url.toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: {
          dateTime: input.startDateTime,
          timeZone: input.timeZone
        },
        end: {
          dateTime: input.endDateTime,
          timeZone: input.timeZone
        },
        attendees: input.attendeeEmails?.map((email) => ({ email }))
      })
    }
  );

  return normalizeEvent(event);
}

export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string
) {
  if (!eventId.trim()) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Calendar event ID is required.",
      400
    );
  }

  const url = new URL(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`);
  await calendarFetch<unknown>(accessToken, url.toString(), {
    method: "DELETE"
  });
  return { deleted: true, eventId };
}
