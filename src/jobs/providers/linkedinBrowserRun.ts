import { ApiError } from "../../utils/api";
import type { JobSearchInput, JobSummary } from "../types";

async function browserRuntime() {
  return import("@cloudflare/playwright");
}

type BrowserTarget = {
  url?: string;
  devtoolsFrontendUrl?: string;
};

function browserApiConfig(env: Env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.BROWSER_RUN_API_TOKEN?.trim();
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "Browser Run login is not configured: CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account ID.",
      503
    );
  }
  if (!token) {
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "Browser Run login is not configured: BROWSER_RUN_API_TOKEN is missing.",
      503
    );
  }
  return {
    base: `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/devtools`,
    token
  };
}

async function browserApi<T>(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { base, token } = browserApiConfig(env);
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: Array<{ message?: string }>;
  } | null;
  const hasEnvelope = Boolean(payload && "success" in payload);
  if (!response.ok || (hasEnvelope && !payload?.success)) {
    const detail = payload?.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      detail || `Browser Run API request failed (HTTP ${response.status}).`,
      response.status >= 400 && response.status < 500 ? response.status : 502
    );
  }
  return (payload?.result ?? payload) as T;
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
  raw: Array<{
    title?: string;
    location?: string;
    link: string;
    description?: string;
  }>
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
      source: "linkedin",
      description: clean(item.description) || undefined
    });
    if (jobs.length >= 20) break;
  }
  return jobs;
}

export async function startLinkedInBrowserSession(env: Env) {
  const result = await browserApi<{
    sessionId: string;
    targets?: BrowserTarget[];
  }>(
    env,
    "/browser?keep_alive=1200000&targets=true&liveViewUrlExpiresInMs=3600000",
    {
      method: "POST"
    }
  );
  let target =
    result.targets?.find((item) => item.devtoolsFrontendUrl) ||
    result.targets?.[0];
  try {
    const loginTarget = await browserApi<BrowserTarget>(
      env,
      `/browser/${encodeURIComponent(result.sessionId)}/json/new?url=${encodeURIComponent("https://www.linkedin.com/login")}&liveViewUrlExpiresInMs=3600000`,
      { method: "PUT" }
    );
    target = loginTarget || target;
  } catch {
    // Fall back to the initial tab if target creation is unavailable.
  }
  return {
    sessionId: result.sessionId,
    authenticated: Boolean(target?.url && authenticatedUrl(target.url)),
    liveViewUrl: target?.devtoolsFrontendUrl || null
  };
}

function authenticatedUrl(url: string) {
  return (
    /linkedin\.com\/(feed|jobs|mynetwork|messaging|in)/i.test(url) &&
    !/login|checkpoint|authwall/i.test(url)
  );
}

export async function getLinkedInBrowserSessionStatus(
  env: Env,
  sessionId: string
) {
  let targets: BrowserTarget[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    targets = await browserApi<BrowserTarget[]>(
      env,
      `/browser/${encodeURIComponent(sessionId)}/json/list?liveViewUrlExpiresInMs=3600000`
    );
    const authenticatedTarget = targets.find(
      (item) => item.url && authenticatedUrl(item.url)
    );
    if (authenticatedTarget) {
      return {
        sessionId,
        authenticated: true,
        url: authenticatedTarget.url || null,
        liveViewUrl: authenticatedTarget.devtoolsFrontendUrl || null
      };
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const target =
    targets.find(
      (item) =>
        item.url && !/^about:blank$/i.test(item.url) && item.devtoolsFrontendUrl
    ) ||
    targets.find((item) => item.devtoolsFrontendUrl) ||
    targets[0];
  return {
    sessionId,
    authenticated: false,
    url: target?.url || null,
    liveViewUrl: target?.devtoolsFrontendUrl || null
  };
}

export async function listLinkedInBrowserSessions(env: Env) {
  const { sessions } = await browserRuntime();
  return sessions(env.BROWSER);
}

export async function searchLinkedInBrowserRun(
  env: Env,
  input: JobSearchInput
): Promise<JobSummary[]> {
  // The session is bound to the authenticated user by ChatAgent. Do not fall
  // back to a global session: that can reuse another user's stale browser.
  const sessionId = input.linkedinSessionId;
  if (!sessionId) {
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      "Connect LinkedIn first so this user has a persistent Browser Run session.",
      409
    );
  }

  const { chromium, endpointURLString, connect } = await browserRuntime();
  let browser: Awaited<ReturnType<typeof connect>> | undefined;
  let lastError: unknown;
  // Live View owns the Browser Run WebSocket while the login window is open.
  // Wait briefly for that connection to be released before the Worker connects.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      // connectOverCDP enables the persistent/default context used by the
      // Browser Run Live View. The plain Workers connect() path can expose
      // zero contexts, which would hide the Live View's LinkedIn cookies.
      const endpoint = new URL(endpointURLString(env.BROWSER, { sessionId }));
      // @cloudflare/playwright uses the browser_session query marker to
      // distinguish connecting to an existing Browser Run session from
      // launching a new one. Without it, connectOverCDP() acquires a fresh
      // browser and cannot see the Live View session's LinkedIn cookies.
      endpoint.searchParams.set("browser_session", sessionId);
      browser = await chromium.connectOverCDP(endpoint.toString());
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/accept|websocket|connection|browser/i.test(message) ||
        attempt === 5
      )
        throw new ApiError(
          "JOB_SEARCH_ERROR",
          /accept|websocket/i.test(message)
            ? "Browser Run is still releasing the LinkedIn Live View session. Close the login window, wait a few seconds, and retry."
            : message,
          502
        );
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  if (!browser) {
    throw new ApiError(
      "JOB_SEARCH_ERROR",
      lastError instanceof Error
        ? lastError.message
        : "Unable to connect to the LinkedIn Browser Run session.",
      502
    );
  }
  try {
    // Reuse the context created for the Browser Run Live View. Creating a new
    // context here would create an isolated profile without LinkedIn cookies.
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new ApiError(
        "JOB_SEARCH_ERROR",
        "The LinkedIn Browser Run session has no reusable browser context.",
        409
      );
    }
    const context = contexts[0];
    const cookies = await context.cookies("https://www.linkedin.com");
    const linkedinCookies = cookies.filter((cookie) =>
      cookie.domain.toLowerCase().includes("linkedin.com")
    );
    if (linkedinCookies.length === 0) {
      throw new ApiError(
        "JOB_SEARCH_ERROR",
        "LinkedIn cookies were not found in the connected Browser Run context. Complete login in the same Live View session, then retry.",
        409
      );
    }
    const page = await context.newPage();
    await page
      .goto("https://www.linkedin.com/feed/", {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      })
      .catch(() => undefined);
    if (!authenticated(page)) {
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
            description: card?.textContent || "",
            link: (anchor as HTMLAnchorElement).href
          };
        })
      );
    return normalizeJobs(raw);
  } finally {
    // For a connected session, close disconnects this Worker while keeping the
    // Browser Run session and its cookies alive for the next request.
    await browser.close().catch(() => undefined);
  }
}
