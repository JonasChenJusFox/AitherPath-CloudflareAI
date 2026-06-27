import { Hono } from "hono";
import type { AppBindings } from "./types/app";
import { logger } from "./middleware/logger";
import { healthRoute } from "./routes/health";
import { helloRoute } from "./routes/hello";
import { chatRoute } from "./routes/chat";

const app = new Hono<AppBindings>();

app.use("*", logger);

app.route("/health", healthRoute);
app.route("/hello", helloRoute);
app.route("/chat", chatRoute);

app.onError((error, c) => {
  console.error(error);

  return c.json(
    {
      error: "Internal server error"
    },
    500
  );
});

app.notFound((c) => {
  return c.json(
    {
      error: "Not found"
    },
    404
  );
});

export default app;
