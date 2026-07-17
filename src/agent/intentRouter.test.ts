import { describe, expect, it } from "vitest";
import { selectActiveTools } from "./intentRouter";

describe("intent tool routing", () => {
  it("selects job search for a job query", () => {
    expect(
      selectActiveTools("Find software engineering internships in New York")
    ).toContain("searchJobs");
  });

  it("selects Gmail inbox for an inbox request", () => {
    expect(selectActiveTools("Summarize my recent inbox emails")).toContain(
      "listGmailInbox"
    );
  });

  it("selects calendar read tools for a schedule query", () => {
    const tools = selectActiveTools("What meetings do I have tomorrow?");
    expect(tools).toContain("listCalendarEventsByDate");
    expect(tools).toContain("listTodayCalendarEvents");
    expect(tools).toContain("checkCalendarAvailability");
    expect(tools).toContain("searchGoogleContacts");
  });

  it("selects contact search for a contact request", () => {
    expect(
      selectActiveTools("Find John Chen's email address in my contacts")
    ).toContain("searchGoogleContacts");
  });
});
