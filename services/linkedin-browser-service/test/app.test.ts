import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/app.js";

const TOKEN = "a".repeat(32);
const config = { LINKEDIN_BROWSER_API_TOKEN: TOKEN } as Parameters<
  typeof createApp
>[0];

describe("browser service HTTP contract", () => {
  it("rejects invalid service tokens", async () => {
    const app = createApp(config, {
      status: async () => ({ browserReady: true, authenticated: true })
    } as never);
    const response = await app.request("http://localhost/search", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ keywords: "Java Engineer" })
    });
    assert.equal(response.status, 401);
  });

  it("maps normalized browser results to the API response", async () => {
    const app = createApp(config, {
      search: async () => [
        {
          title: "Java Engineer",
          company: "Example",
          location: "New York",
          link: "https://www.linkedin.com/jobs/view/1",
          source: "linkedin"
        }
      ]
    } as never);
    const response = await app.request("http://localhost/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ keywords: "Java Engineer", limit: 5 })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      jobs: [
        {
          title: "Java Engineer",
          company: "Example",
          location: "New York",
          link: "https://www.linkedin.com/jobs/view/1",
          source: "linkedin"
        }
      ]
    });
  });
});
