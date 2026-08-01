import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalLinkedInUrl, normalizeJobs } from "../src/normalize.js";

describe("LinkedIn URL normalization", () => {
  it("removes tracking parameters", () =>
    assert.equal(
      canonicalLinkedInUrl("https://www.linkedin.com/jobs/view/123?trk=abc"),
      "https://www.linkedin.com/jobs/view/123"
    ));
  it("deduplicates and limits jobs", () =>
    assert.equal(
      normalizeJobs(
        [
          {
            link: "https://www.linkedin.com/jobs/view/1?trk=x",
            title: " Java  Engineer "
          },
          { link: "https://www.linkedin.com/jobs/view/1", title: "duplicate" },
          {
            link: "https://www.linkedin.com/jobs/view/2",
            title: "Frontend Engineer"
          }
        ],
        2
      ).length,
      2
    ));
});
