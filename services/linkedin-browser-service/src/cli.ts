import { loadConfig } from "./config.js";
import { BrowserManager } from "./browser.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2)
  args.set(
    process.argv[index].replace(/^--/, ""),
    process.argv[index + 1] || ""
  );
const config = loadConfig();
const browser = new BrowserManager(config);
try {
  console.log("Opening LinkedIn in the persistent browser profile.");
  console.log(
    "If login is requested, complete it manually in Chromium; no credentials are automated."
  );
  const jobs = await browser.search(
    args.get("keywords") || "Java Engineer",
    args.get("location"),
    Math.min(Math.max(Number(args.get("limit") || 5), 1), 20)
  );
  console.log(JSON.stringify({ jobs }, null, 2));
} finally {
  await browser.close();
}
