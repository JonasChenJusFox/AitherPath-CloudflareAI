import { ApiError } from "../../utils/api";
import type { JobSearchInput, JobSummary } from "../types";

type BrowserSearchResponse = { jobs?: Array<Omit<JobSummary, "source">> };

/** Calls an external user-controlled Playwright service; Workers cannot run a browser process. */
export async function searchLinkedInBrowser(
  endpoint: string,
  apiToken: string,
  input: JobSearchInput
): Promise<JobSummary[]> {
  const searchUrl = endpoint.replace(/\/$/, "").endsWith("/search")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/search`;
  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      keywords: input.keywords,
      location: input.location,
      sessionId: input.linkedinSessionId,
      limit: 20
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 401)
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "LinkedIn browser service authentication failed.",
      502
    );
  if (response.status === 409)
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "Complete LinkedIn login in the browser service, then retry.",
      409
    );
  if (!response.ok)
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "LinkedIn browser search is unavailable.",
      response.status
    );
  const data = await response.json<BrowserSearchResponse>();
  if (!Array.isArray(data.jobs))
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "LinkedIn browser service returned an invalid response.",
      502
    );
  return (data.jobs || []).map((job) => ({ ...job, source: "linkedin" }));
}
