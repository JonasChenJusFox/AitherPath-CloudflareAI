import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCalendarEvent,
  getTodayBounds,
  listCalendarEvents
} from "./calendar";
import { ApiError } from "../utils/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calendar service", () => {
  it("builds list-events query parameters", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("timeMin")).toBe("2026-07-10T10:00:00.000Z");
      expect(url.searchParams.get("timeMax")).toBe("2026-07-10T11:00:00.000Z");
      expect(url.searchParams.get("singleEvents")).toBe("true");
      expect(url.searchParams.get("orderBy")).toBe("startTime");
      expect(url.searchParams.get("timeZone")).toBe("America/New_York");
      expect(url.searchParams.get("maxResults")).toBe("5");

      return Response.json({
        items: [
          {
            id: "event-1",
            summary: "Project sync",
            start: { dateTime: "2026-07-10T10:00:00-04:00" },
            end: { dateTime: "2026-07-10T11:00:00-04:00" }
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listCalendarEvents("token", {
      timeMin: "2026-07-10T10:00:00.000Z",
      timeMax: "2026-07-10T11:00:00.000Z",
      timeZone: "America/New_York",
      maxResults: 5
    });

    expect(result.events[0]?.summary).toBe("Project sync");
  });

  it("calculates today's boundaries in the requested time zone", () => {
    const bounds = getTodayBounds(
      "America/New_York",
      new Date("2026-07-10T15:00:00.000Z")
    );

    expect(bounds.timeMin).toBe("2026-07-10T04:00:00.000Z");
    expect(bounds.timeMax).toBe("2026-07-11T04:00:00.000Z");
  });

  it("rejects event creation when the end is before the start", async () => {
    await expect(
      createCalendarEvent("token", {
        summary: "Bad meeting",
        startDateTime: "2026-07-10T12:00:00-04:00",
        endDateTime: "2026-07-10T11:00:00-04:00",
        timeZone: "America/New_York"
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("sends the expected create-event request", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          summary: "Interview",
          attendees: [{ email: "person@example.com" }]
        });

        return Response.json({
          id: "event-2",
          summary: "Interview",
          start: { dateTime: "2026-07-12T13:00:00-04:00" },
          end: { dateTime: "2026-07-12T13:30:00-04:00" }
        });
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCalendarEvent("token", {
      summary: "Interview",
      startDateTime: "2026-07-12T13:00:00-04:00",
      endDateTime: "2026-07-12T13:30:00-04:00",
      timeZone: "America/New_York",
      attendeeEmails: ["person@example.com"]
    });

    expect(result.id).toBe("event-2");
  });
});
