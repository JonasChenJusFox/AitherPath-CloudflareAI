import { describe, expect, it } from "vitest";
import { decisionForScore, evaluateJobMatch } from "./evaluation";

describe("resume job evaluation", () => {
  it("keeps the Apply gate strictly above 80", () => {
    expect(decisionForScore(80)).toBe("skip");
    expect(decisionForScore(80.01)).toBe("apply");
  });

  it("returns a skip reason when the resume is not a strong match", async () => {
    const evaluation = await evaluateJobMatch(
      {} as Env,
      "test-user",
      {
        summary: "Student learning design",
        skills: [{ name: "Figma" }],
        projects: [],
        education: [],
        experience: []
      },
      {
        title: "Senior Java Backend Engineer",
        company: "Example",
        location: "Remote",
        link: "https://example.com/job",
        source: "jooble",
        description: "Spring Boot and distributed systems"
      }
    );

    expect(evaluation.decision).toBe("skip");
    expect(evaluation.reason).toContain(
      "below the required 80-point threshold"
    );
  });
});
