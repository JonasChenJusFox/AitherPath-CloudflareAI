import { searchJooble } from "./providers/jooble";
import { searchLinkedInBrowser } from "./providers/linkedinBrowser";
import { searchLinkedInBrowserRun } from "./providers/linkedinBrowserRun";
import { ApiError } from "../utils/api";
import type {
  JobSearchInput,
  JobSource,
  JobSummary,
  ProviderStatus
} from "./types";

export type AggregatedJobSearch = {
  jobs: JobSummary[];
  providers: ProviderStatus[];
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeAndSort(jobs: JobSummary[]) {
  const seen = new Set<string>();
  return jobs
    .filter((job) => {
      const identity =
        normalize(job.link) ||
        `${normalize(job.title)}|${normalize(job.company)}|${normalize(job.location)}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 20);
}

export async function searchAcrossProviders(
  env: Env,
  input: JobSearchInput
): Promise<AggregatedJobSearch> {
  const requested: JobSource[] = input.sources?.length
    ? input.sources
    : ["jooble"];
  const providers: ProviderStatus[] = [];
  const searches: Array<{
    provider: JobSource;
    promise: Promise<JobSummary[]>;
  }> = [];

  if (requested.includes("jooble")) {
    if (!env.JOOBLE_API_KEY?.trim())
      providers.push({
        provider: "jooble",
        status: "error",
        message: "JOOBLE_API_KEY is not configured."
      });
    else
      searches.push({
        provider: "jooble",
        promise: searchJooble(env.JOOBLE_API_KEY, input).then((jobs) => {
          providers.push({ provider: "jooble", status: "ok" });
          return jobs;
        })
      });
  }

  if (requested.includes("linkedin")) {
    if (env.BROWSER) {
      searches.push({
        provider: "linkedin",
        promise: searchLinkedInBrowserRun(env, input).then((jobs) => {
          providers.push({ provider: "linkedin", status: "ok" });
          return jobs;
        })
      });
    } else {
      const endpoint = env.LINKEDIN_BROWSER_SEARCH_URL?.trim();
      const token = env.LINKEDIN_BROWSER_API_TOKEN?.trim();
      if (!endpoint || !token)
        providers.push({
          provider: "linkedin",
          status: "skipped",
          message:
            "Start a LinkedIn browser session and configure the browser service first."
        });
      else
        searches.push({
          provider: "linkedin",
          promise: searchLinkedInBrowser(endpoint, token, input).then(
            (jobs) => {
              providers.push({ provider: "linkedin", status: "ok" });
              return jobs;
            }
          )
        });
    }
  }

  const results = await Promise.allSettled(
    searches.map((search) => search.promise)
  );
  const jobs: JobSummary[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") jobs.push(...result.value);
    else
      providers.push({
        provider: searches[index].provider,
        status: "error",
        message:
          result.reason instanceof ApiError
            ? result.reason.message
            : result.reason instanceof Error
              ? result.reason.message
              : "A job provider request failed."
      });
  });
  return { jobs: dedupeAndSort(jobs), providers };
}
