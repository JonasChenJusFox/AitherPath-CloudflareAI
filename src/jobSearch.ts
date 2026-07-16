export type JobSearchInput = {
  keywords: string;
  location?: string;
};

export type JobSummary = {
  title: string;
  company: string;
  location: string;
  link: string;
};

type JoobleJob = {
  title?: string;
  company?: string;
  location?: string;
  link?: string;
};

type JoobleResponse = {
  jobs?: JoobleJob[];
};

export async function searchJobs(
  apiKey: string,
  input: JobSearchInput
): Promise<JobSummary[]> {
  // Jooble expects the API key in the URL and the search query in the JSON body.
  const response = await fetch(`https://jooble.org/api/${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      keywords: input.keywords,
      location: input.location || ""
    })
  });

  if (!response.ok) {
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "Unable to communicate with the job search provider.",
      response.status
    );
  }

  const data = await response.json<JoobleResponse>();
  const jobs = data.jobs || [];

  // Keep only the fields the agent needs so the model receives a predictable shape.
  return jobs.slice(0, 5).map((job) => ({
    title: job.title || "Untitled role",
    company: job.company || "Unknown company",
    location: job.location || "Unknown location",
    link: job.link || ""
  }));
}
import { ApiError } from "./utils/api";
