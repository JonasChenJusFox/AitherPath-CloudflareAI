import { describe, expect, it, vi } from "vitest";
import { normalizeFileData, parseResumeText } from "./resume";

describe("resume upload payloads", () => {
  it("keeps the PDF data URL payload compatible with the Responses adapter", () => {
    const dataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
    const payload = normalizeFileData(dataUrl);

    expect(payload).toBe("JVBERi0xLjQ=");
    expect(`data:application/pdf;base64,${payload}`).toBe(dataUrl);
  });

  it("sends PDF bytes directly to Responses and validates the profile", async () => {
    const responseProfile = {
      name: "Jonas Chen",
      email: "jonas@example.com",
      location: null,
      summary: null,
      skills: [{ name: "TypeScript", level: null, evidence: "Projects" }],
      projects: [],
      education: [],
      experience: []
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(responseProfile)
                }
              ]
            }
          ]
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const profile = await parseResumeText(
        {
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "gpt-5.4-mini"
        } as Env,
        {
          fileData: "data:application/pdf;base64,JVBERi0xLjQ=",
          mediaType: "application/pdf",
          fileName: "resume.pdf"
        }
      );

      const requestBody = JSON.parse(
        fetchMock.mock.calls[0]?.[1]?.body as string
      );
      expect(requestBody.input[1].content[0].file_data).toBe(
        "data:application/pdf;base64,JVBERi0xLjQ="
      );
      expect(requestBody.input[1].content[0].detail).toBe("low");
      expect(requestBody.text.format.type).toBe("json_schema");
      expect(profile.name).toBe("Jonas Chen");
      expect(profile.skills[0]?.name).toBe("TypeScript");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
