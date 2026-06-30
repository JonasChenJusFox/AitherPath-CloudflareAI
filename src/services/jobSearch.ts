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

export async function searchJobs(apiKey: string, input: JobSearchInput): Promise<JobSummary[]> {
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
    throw new Error(`Jooble request failed with status ${response.status}`);
  }

  const data = await response.json<JoobleResponse>();
  const jobs = data.jobs || [];

  return jobs.slice(0, 5).map((job) => ({
    title: job.title || "Untitled role",
    company: job.company || "Unknown company",
    location: job.location || "Unknown location",
    link: job.link || ""
  }));
}

export function parseJobQuery(message: string): JobSearchInput | null {
  const trimmed = message.trim();
  const match = /^(?:jobs?|search jobs?)\s+(.+)$/i.exec(trimmed);

  if (!match) {
    return null;
  }

  const query = match[1].trim();
  const locationSplit = query.match(/^(.+?)\s+in\s+(.+)$/i);

  if (!locationSplit) {
    return {
      keywords: query
    };
  }

  return {
    keywords: locationSplit[1].trim(),
    location: locationSplit[2].trim()
  };
}
