import { ApiError } from "../../utils/api";
import type { JobSearchInput, JobSummary } from "../types";

async function browserRuntime() {
  return import("@cloudflare/playwright");
}

function clean(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function authenticated(page: { url(): string }) {
  const url = page.url();
  return (
    /linkedin\.com\/(feed|jobs|mynetwork|messaging|in)/i.test(url) &&
    !/login|checkpoint|authwall/i.test(url)
  );
}

function normalizeJobs(
  raw: Array<{ title?: string; location?: string; link: string }>
) {
  const seen = new Set<string>();
  const jobs: JobSummary[] = [];
  for (const item of raw) {
    const match = item.link.match(/\/jobs\/view\/(\d+)/i);
    if (!match) continue;
    const link = `https://www.linkedin.com/jobs/view/${match[1]}`;
    if (seen.has(link)) continue;
    seen.add(link);
    jobs.push({
      title: clean(item.title) || "Untitled role",
      company: "",
      location: clean(item.location),
      link,
      source: "linkedin"
    });
    if (jobs.length >= 20) break;
  }
  return jobs;
}

export async function startLinkedInBrowserSession(env: Env) {
  const { acquire } = await browserRuntime();
  const { sessionId } = await acquire(env.BROWSER, { keep_alive: 600_000 });
  return { sessionId, authenticated: false };
}

export async function listLinkedInBrowserSessions(env: Env) {
  const { sessions } = await browserRuntime();
  return sessions(env.BROWSER);
}

export async function searchLinkedInBrowserRun(
  env: Env,
  input: JobSearchInput
): Promise<JobSummary[]> {
  const sessionId = input.linkedinSessionId || env.LINKEDIN_BROWSER_SESSION_ID;
  if (!sessionId) {
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "Start a Browser Run LinkedIn session and configure LINKEDIN_BROWSER_SESSION_ID.",
      409
    );
  }

  const { connect } = await browserRuntime();
  const browser = await connect(env.BROWSER, sessionId);
  const page = browser.contexts()[0]?.pages()[0] || (await browser.newPage());
  if (!authenticated(page)) {
    await page
      .goto("https://www.linkedin.com/feed/", {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      })
      .catch(() => undefined);
  }
  if (!authenticated(page)) {
    await browser.close();
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "Complete LinkedIn login in the Browser Run Live Session, then retry.",
      409
    );
  }

  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", input.keywords);
  if (input.location) url.searchParams.set("location", input.location);
  await page.goto(url.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });
  await page
    .locator('a[href*="/jobs/view/"]')
    .first()
    .waitFor({
      state: "visible",
      timeout: 20_000
    })
    .catch(() => undefined);
  const raw = await page
    .locator('a[href*="/jobs/view/"]')
    .evaluateAll((anchors) =>
      anchors.map((anchor) => {
        const card = anchor.closest("li") || anchor.parentElement;
        return {
          title: anchor.textContent || "",
          location: card?.textContent || "",
          link: (anchor as HTMLAnchorElement).href
        };
      })
    );
  await browser.close();
  return normalizeJobs(raw);
}
