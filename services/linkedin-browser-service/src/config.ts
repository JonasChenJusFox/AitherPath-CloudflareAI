import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LINKEDIN_BROWSER_API_TOKEN: z.string().min(16),
  LINKEDIN_PROFILE_DIR: z.string().min(1).default(".data/linkedin-profile"),
  HEADLESS: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  LOGIN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(30_000)
    .max(900_000)
    .default(300_000)
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);
  return {
    ...parsed,
    profileDir: path.resolve(process.cwd(), parsed.LINKEDIN_PROFILE_DIR)
  };
}
