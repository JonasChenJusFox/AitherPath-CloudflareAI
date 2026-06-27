import { Hono } from "hono";
import type { AppBindings } from "../types/app";

export const healthRoute = new Hono<AppBindings>();

// Health checks help confirm the Worker is running correctly.
healthRoute.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "cloudflare-ai-assistant",
    week: 1
  });
});
