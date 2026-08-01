import { ApiError } from "../../utils/api";
import type { JobSearchInput, JobSummary } from "../types";

type JoobleJob = {
  title?: string;
  company?: string;
  location?: string;
  link?: string;
};
type JoobleResponse = { jobs?: JoobleJob[] };

export async function searchJooble(
  apiKey: string,
  input: JobSearchInput
): Promise<JobSummary[]> {
  const response = await fetch(`https://jooble.org/api/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keywords: input.keywords,
      location: input.location || ""
    })
  });
  if (!response.ok)
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "Unable to communicate with the Jooble provider.",
      response.status
    );
  const data = await response.json<JoobleResponse>();
  return (data.jobs || []).slice(0, 20).map((job) => ({
    title: job.title || "Untitled role",
    company: job.company || "Unknown company",
    location: job.location || "Unknown location",
    link: job.link || "",
    source: "jooble"
  }));
}
