import { describe, expect, it } from "vitest";
import {
  getDateInTimeZone,
  getRelativeDateInTimeZone,
  isValidTimeZone,
  extractTimeZone
} from "./time";

describe("time-zone date handling", () => {
  it("resolves today and tomorrow in the user's time zone", () => {
    const now = new Date("2026-07-15T17:30:00.000Z");
    expect(getDateInTimeZone(now, "Asia/Shanghai")).toBe("2026-07-16");
    expect(getRelativeDateInTimeZone(now, "Asia/Shanghai", 1)).toBe(
      "2026-07-17"
    );
    expect(getDateInTimeZone(now, "America/New_York")).toBe("2026-07-15");
  });

  it("validates IANA time-zone identifiers", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("extracts only explicit IANA time zones", () => {
    expect(extractTimeZone("my preferred time zone is America/New_York")).toBe(
      "America/New_York"
    );
    expect(extractTimeZone("I am in New York")).toBe(null);
  });
});
