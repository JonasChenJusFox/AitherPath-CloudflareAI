import { Hono } from "hono";
import type { AppBindings } from "../types/app";
import { jsonError } from "../utils/response";
import { searchJobs } from "../services/jobSearch";

type JobSearchBody = {
  keywords?: unknown;
  location?: unknown;
};

export const jobsRoute = new Hono<AppBindings>();

jobsRoute.post("/", async (c) => {
  let body: JobSearchBody;

  try {
    body = await c.req.json<JobSearchBody>();
  } catch {
    const error = jsonError("Request body must be valid JSON.");
    return c.json(error.body, error.status);
  }

  if (typeof body.keywords !== "string" || body.keywords.trim().length === 0) {
    const error = jsonError("Keywords are required and must be a non-empty string.");
    return c.json(error.body, error.status);
  }

  if (body.location !== undefined && typeof body.location !== "string") {
    const error = jsonError("Location must be a string when provided.");
    return c.json(error.body, error.status);
  }

  if (!c.env.JOOBLE_API_KEY) {
    return c.json(
      {
        error: "Job search is not configured. Add JOOBLE_API_KEY as a Cloudflare secret."
      },
      503
    );
  }

  const jobs = await searchJobs(c.env.JOOBLE_API_KEY, {
    keywords: body.keywords.trim(),
    location: body.location?.trim()
  });

  return c.json({
    jobs
  });
});
