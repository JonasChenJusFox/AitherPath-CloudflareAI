export type LinkedInJob = {
  title: string;
  company: string;
  location: string;
  link: string;
  source: "linkedin";
};

export function canonicalLinkedInUrl(raw: string) {
  try {
    const url = new URL(raw, "https://www.linkedin.com");
    const match = url.pathname.match(/\/jobs\/view\/(\d+)/i);
    return match ? `https://www.linkedin.com/jobs/view/${match[1]}` : null;
  } catch {
    return null;
  }
}

export function normalizeWhitespace(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export type RawLinkedInJob = {
  title?: string;
  company?: string;
  location?: string;
  link: string;
};

export function normalizeJobs(
  rawJobs: RawLinkedInJob[],
  limit: number
): LinkedInJob[] {
  const seen = new Set<string>();
  const jobs: LinkedInJob[] = [];
  for (const raw of rawJobs) {
    const link = canonicalLinkedInUrl(raw.link);
    if (!link || seen.has(link)) continue;
    seen.add(link);
    jobs.push({
      title: normalizeWhitespace(raw.title) || "Untitled role",
      company: normalizeWhitespace(raw.company),
      location: normalizeWhitespace(raw.location),
      link,
      source: "linkedin"
    });
    if (jobs.length >= limit) break;
  }
  return jobs;
}
