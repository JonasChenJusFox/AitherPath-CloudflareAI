import { Hono } from "hono";
import { z } from "zod";
import { BrowserManager, LoginRequiredError } from "./browser.js";
import type { loadConfig } from "./config.js";

const searchSchema = z
  .object({
    keywords: z.string().trim().min(1),
    location: z.string().trim().optional(),
    limit: z.number().int().min(1).max(20).default(5),
    sessionId: z.string().trim().min(1).optional()
  })
  .strict();

export function createApp(
  config: ReturnType<typeof loadConfig>,
  browser: BrowserManager
) {
  const app = new Hono();
  app.get("/health", async (c) => {
    const status = await browser.status();
    return c.json({
      ok: true,
      service: "linkedin-browser-service",
      ...status
    });
  });
  app.post("/search", async (c) => {
    if (
      c.req.header("Authorization") !==
      `Bearer ${config.LINKEDIN_BROWSER_API_TOKEN}`
    )
      return c.json({ error: "UNAUTHORIZED" }, 401);
    let input: z.infer<typeof searchSchema>;
    try {
      input = searchSchema.parse(await c.req.json());
    } catch {
      return c.json(
        {
          error: "INVALID_REQUEST",
          message: "keywords is required and limit must be between 1 and 20."
        },
        400
      );
    }
    try {
      const jobs = await browser.search(
        input.keywords,
        input.location,
        input.limit
      );
      return c.json({ jobs });
    } catch (error) {
      if (error instanceof LoginRequiredError)
        return c.json({ error: error.code, message: error.message }, 409);
      return c.json(
        {
          error: "BROWSER_SEARCH_FAILED",
          message: "LinkedIn browser search failed."
        },
        502
      );
    }
  });
  return app;
}
