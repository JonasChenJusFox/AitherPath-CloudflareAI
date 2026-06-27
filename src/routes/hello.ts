import { Hono } from "hono";
import type { AppBindings } from "../types/app";

export const helloRoute = new Hono<AppBindings>();

helloRoute.get("/", (c) => {
  const name = c.req.query("name") || "guest";

  return c.json({
    message: `Hello, ${name}!`
  });
});
