import { chromium, type BrowserContext, type Page } from "playwright";
import type { loadConfig } from "./config.js";
import { normalizeJobs, type LinkedInJob } from "./normalize.js";

type ServiceConfig = ReturnType<typeof loadConfig>;

export class LoginRequiredError extends Error {
  readonly code = "LOGIN_REQUIRED";
}

export class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ServiceConfig) {}

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation;
    let release!: () => void;
    this.operation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async ensureContext() {
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(
        this.config.profileDir,
        {
          headless: this.config.HEADLESS,
          viewport: { width: 1440, height: 1000 }
        }
      );
    }
    this.page ||= this.context.pages()[0] || (await this.context.newPage());
    return this.page;
  }

  private isAuthenticated(page: Page) {
    const url = page.url();
    return (
      /linkedin\.com\/(feed|jobs|mynetwork|messaging|in)/i.test(url) &&
      !/login|checkpoint|authwall/i.test(url)
    );
  }

  private async ensureAuthenticatedUnlocked() {
    const page = await this.ensureContext();
    await page.bringToFront().catch(() => undefined);
    if (!this.isAuthenticated(page)) {
      try {
        await page.goto("https://www.linkedin.com/feed/", {
          waitUntil: "domcontentloaded",
          timeout: 30_000
        });
      } catch (error) {
        console.error(
          `Unable to open LinkedIn (${error instanceof Error ? error.message : "network error"}). Check network/VPN access.`
        );
      }
    }
    if (this.isAuthenticated(page)) return page;
    if (!this.config.HEADLESS)
      console.log(
        "Complete LinkedIn login in the opened browser. The service will continue after login."
      );
    const deadline = Date.now() + this.config.LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.isAuthenticated(page)) return page;
      await page.waitForTimeout(1_000);
    }
    throw new LoginRequiredError(
      "Complete LinkedIn login in the opened browser and retry."
    );
  }

  async ensureAuthenticated() {
    return this.withLock(() => this.ensureAuthenticatedUnlocked());
  }

  async status() {
    return this.withLock(async () => {
      const page = await this.ensureContext();
      await page.bringToFront().catch(() => undefined);
      if (page.url() === "about:blank") {
        try {
          await page.goto("https://www.linkedin.com/feed/", {
            waitUntil: "domcontentloaded",
            timeout: 30_000
          });
        } catch (error) {
          console.error(
            `Unable to open LinkedIn (${error instanceof Error ? error.message : "network error"}). Check network/VPN access.`
          );
        }
      }
      return { browserReady: true, authenticated: this.isAuthenticated(page) };
    });
  }

  async search(
    keywords: string,
    location: string | undefined,
    limit: number
  ): Promise<LinkedInJob[]> {
    return this.withLock(async () => {
      const page = await this.ensureAuthenticatedUnlocked();
      const url = new URL("https://www.linkedin.com/jobs/search/");
      url.searchParams.set("keywords", keywords);
      if (location) url.searchParams.set("location", location);
      console.log(`Opening LinkedIn Jobs search: ${url.toString()}`);
      await page.goto(url.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      await page
        .locator('a[href*="/jobs/view/"]')
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => undefined);
      const raw = await page
        .locator('a[href*="/jobs/view/"]')
        .evaluateAll((anchors) =>
          anchors.map((anchor) => {
            const card = anchor.closest("li") || anchor.parentElement;
            const text = (card?.textContent || "").replace(/\s+/g, " ").trim();
            return {
              title: anchor.textContent || "",
              company: "",
              location: text,
              link: (anchor as HTMLAnchorElement).href
            };
          })
        );
      return normalizeJobs(raw, limit);
    });
  }

  async close() {
    await this.context?.close();
    this.context = null;
    this.page = null;
  }
}
