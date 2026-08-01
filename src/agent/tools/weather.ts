import { tool } from "ai";
import { z } from "zod";
import { getCurrentWeather } from "../../week1/weather";
import { safeToolExecution } from "../toolErrors";
import type { AgentToolContext } from "../types";

export function createWeatherTools(_context: AgentToolContext) {
  return {
    getCurrentWeather: tool({
      description:
        "Get current weather for a city. This is a read-only Week 1 practice tool.",
      inputSchema: z
        .object({ city: z.string().trim().min(2).max(100) })
        .strict(),
      execute: async ({ city }) =>
        safeToolExecution(
          () => getCurrentWeather(city),
          "Weather lookup failed. Please try again."
        )
    })
  };
}
