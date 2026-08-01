import type { AgentToolContext } from "./types";
import { createCalendarTools } from "./tools/calendar";
import { createContactsTools } from "./tools/contacts";
import { createGmailTools } from "./tools/gmail";
import { createJobsTools } from "./tools/jobs";
import { createMemoryTools } from "./tools/memory";
import { createWorkflowTools } from "./tools/workflow";
import { createWeatherTools } from "./tools/weather";

export function createToolRegistry(context: AgentToolContext) {
  return {
    ...createJobsTools(context),
    ...createGmailTools(context),
    ...createCalendarTools(context),
    ...createContactsTools(context),
    ...createMemoryTools(context),
    ...createWorkflowTools(context),
    ...createWeatherTools(context)
  };
}

export type AgentToolRegistry = ReturnType<typeof createToolRegistry>;
