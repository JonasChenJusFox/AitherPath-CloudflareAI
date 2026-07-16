import { describe, expect, it } from "vitest";
import { memoryPostSchema } from "../../schemas/week3";
import { createCalendarEventToolSchema } from "./calendar";
import { sendGmailEmailToolSchema } from "./gmail";

describe("agent tool validation", () => {
  it("rejects invalid email addresses", () => {
    expect(
      sendGmailEmailToolSchema.safeParse({
        to: "not-an-email",
        subject: "Hello",
        body: "Message"
      }).success
    ).toBe(false);
  });

  it("rejects empty email subjects and bodies", () => {
    expect(
      sendGmailEmailToolSchema.safeParse({
        to: "person@example.com",
        subject: " ",
        body: " "
      }).success
    ).toBe(false);
  });

  it("rejects calendar timestamps without offsets", () => {
    expect(
      createCalendarEventToolSchema.safeParse({
        summary: "Interview",
        startDateTime: "2026-07-16T14:00:00",
        endDateTime: "2026-07-16T14:30:00",
        timeZone: "Asia/Shanghai"
      }).success
    ).toBe(false);
  });

  it("rejects end-before-start calendar events", () => {
    expect(
      createCalendarEventToolSchema.safeParse({
        summary: "Interview",
        startDateTime: "2026-07-16T15:00:00+08:00",
        endDateTime: "2026-07-16T14:30:00+08:00",
        timeZone: "Asia/Shanghai"
      }).success
    ).toBe(false);
  });

  it("rejects invalid memory keys and oversized values", () => {
    expect(
      memoryPostSchema.safeParse({ key: "bad key", value: "x" }).success
    ).toBe(false);
    expect(
      memoryPostSchema.safeParse({
        key: "profile:summary",
        value: "x".repeat(2001)
      }).success
    ).toBe(false);
  });
});
