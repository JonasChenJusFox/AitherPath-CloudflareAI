import { describe, expect, it } from "vitest";
import { normalizeFileData } from "./resume";

describe("resume upload payloads", () => {
  it("keeps the PDF data URL payload compatible with the Responses adapter", () => {
    const dataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
    const payload = normalizeFileData(dataUrl);

    expect(payload).toBe("JVBERi0xLjQ=");
    expect(`data:application/pdf;base64,${payload}`).toBe(dataUrl);
  });
});
