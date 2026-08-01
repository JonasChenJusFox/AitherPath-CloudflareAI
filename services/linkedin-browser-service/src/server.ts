import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { BrowserManager } from "./browser.js";
import { createApp } from "./app.js";

const config = loadConfig();
const browser = new BrowserManager(config);
const server = serve(
  { fetch: createApp(config, browser).fetch, port: config.PORT },
  (info) => {
    console.log(
      `LinkedIn browser service listening on http://localhost:${info.port}`
    );
  }
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await browser.close();
    server.close();
    process.exit(0);
  });
}
