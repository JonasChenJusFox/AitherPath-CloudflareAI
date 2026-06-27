import type { MiddlewareHandler } from "hono";

export const logger: MiddlewareHandler = async (c, next) => {
  const startTime = Date.now();

  await next();

  const durationMs = Date.now() - startTime;
  const method = c.req.method;
  const path = c.req.path;
  const status = c.res.status;

  console.log(`${method} ${path} ${status} ${durationMs}ms`);
};
