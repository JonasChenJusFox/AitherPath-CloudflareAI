import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonError(message: string, status: ContentfulStatusCode = 400) {
  return {
    body: {
      error: message
    },
    status
  };
}
