import { Hono } from "hono";
import type { AppBindings } from "../types/app";
import { jsonError } from "../utils/response";
import { parseJobQuery, searchJobs } from "../services/jobSearch";

type ChatRequestBody = {
  message?: unknown;
};

export const chatRoute = new Hono<AppBindings>();

chatRoute.post("/", async (c) => {
  let body: ChatRequestBody;

  try {
    // The request body is untrusted, so it is parsed and validated before use.
    body = await c.req.json<ChatRequestBody>();
  } catch {
    const error = jsonError("Request body must be valid JSON.");
    return c.json(error.body, error.status);
  }

  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    const error = jsonError("Message is required and must be a non-empty string.");
    return c.json(error.body, error.status);
  }

  const jobQuery = parseJobQuery(body.message);

  if (jobQuery) {
    if (!c.env.JOOBLE_API_KEY) {
      return c.json(
        {
          error: "Job search is not configured. Add JOOBLE_API_KEY as a Cloudflare secret."
        },
        503
      );
    }

    const jobs = await searchJobs(c.env.JOOBLE_API_KEY, jobQuery);

    return c.json({
      reply: `Found ${jobs.length} jobs for "${jobQuery.keywords}".`,
      jobs
    });
  }

  return c.json({
    reply: `You said: ${body.message}`
  });
});
