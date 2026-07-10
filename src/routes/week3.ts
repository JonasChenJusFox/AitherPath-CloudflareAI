import { getGoogleSession, appendCookies } from "../auth/googleSession";
import {
  createCalendarEvent,
  listCalendarEvents,
  listTodayCalendarEvents
} from "../google/calendar";
import { searchContacts } from "../google/contacts";
import {
  contactsSearchSchema,
  createEventSchema,
  listEventsSchema,
  listTodayEventsSchema,
  parseJsonBody,
  parseSearchParams
} from "../schemas/week3";
import {
  ApiError,
  errorJson,
  getRequestId,
  normalizeError,
  successJson
} from "../utils/api";
import { z } from "zod";

function getUserAgentStub(env: Env, email: string) {
  const id = env.ChatAgent.idFromName(`google:${email.toLowerCase()}`);
  return env.ChatAgent.get(id);
}

async function forwardToUserStorage(
  env: Env,
  email: string,
  request: Request,
  path: string
) {
  const url = new URL(request.url);
  url.pathname = path;
  const headers = new Headers(request.headers);
  headers.set("X-WorkingHelper-Internal", "week3");

  return getUserAgentStub(env, email).fetch(
    new Request(url.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" ? null : request.body
    })
  );
}

async function withGoogleAuth(
  request: Request,
  env: Env,
  handler: (
    session: NonNullable<Awaited<ReturnType<typeof getGoogleSession>>>
  ) => Promise<Response>
) {
  const session = await getGoogleSession(request, env);
  if (!session) {
    throw new ApiError(
      "AUTHENTICATION_REQUIRED",
      "Google authentication is required.",
      401
    );
  }

  const response = await handler(session);
  return appendCookies(response, session.cookies);
}

function validateDateRange(timeMin: string, timeMax: string) {
  const start = new Date(timeMin);
  const end = new Date(timeMax);
  if (end <= start) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "timeMax must be after timeMin.",
      400
    );
  }
}

export async function handleWeek3Routes(request: Request, env: Env) {
  const url = new URL(request.url);
  const requestId = getRequestId(request);

  if (
    !url.pathname.startsWith("/api/calendar") &&
    !url.pathname.startsWith("/api/contacts") &&
    !url.pathname.startsWith("/api/preferences") &&
    !url.pathname.startsWith("/api/memory")
  ) {
    return null;
  }

  try {
    if (url.pathname === "/api/calendar/today" && request.method === "GET") {
      return await withGoogleAuth(request, env, async (session) => {
        const input = parseSearchParams(listTodayEventsSchema, url);
        return successJson(
          await listTodayCalendarEvents(
            session.accessToken,
            input.timeZone,
            input.maxResults
          )
        );
      });
    }

    if (url.pathname === "/api/calendar/events" && request.method === "GET") {
      return await withGoogleAuth(request, env, async (session) => {
        const input = parseSearchParams(listEventsSchema, url);
        validateDateRange(input.timeMin, input.timeMax);
        return successJson(
          await listCalendarEvents(session.accessToken, input)
        );
      });
    }

    if (url.pathname === "/api/calendar/events" && request.method === "POST") {
      return await withGoogleAuth(request, env, async (session) => {
        const input = await parseJsonBody(createEventSchema, request);
        return successJson(
          await createCalendarEvent(session.accessToken, input),
          {
            status: 201
          }
        );
      });
    }

    if (url.pathname === "/api/contacts/search" && request.method === "GET") {
      return await withGoogleAuth(request, env, async (session) => {
        const input = parseSearchParams(contactsSearchSchema, url);
        return successJson(
          await searchContacts(session.accessToken, input.q, input.pageSize)
        );
      });
    }

    if (url.pathname === "/api/preferences") {
      return await withGoogleAuth(request, env, async (session) =>
        forwardToUserStorage(
          env,
          session.email,
          request,
          "/internal/week3/preferences"
        )
      );
    }

    if (url.pathname === "/api/memory") {
      return await withGoogleAuth(request, env, async (session) =>
        forwardToUserStorage(
          env,
          session.email,
          request,
          "/internal/week3/memory"
        )
      );
    }

    return errorJson(
      new ApiError("VALIDATION_ERROR", "Unsupported Week 3 route.", 404),
      requestId
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorJson(
        new ApiError("VALIDATION_ERROR", "Invalid request input.", 400),
        requestId
      );
    }

    return errorJson(normalizeError(error), requestId);
  }
}
