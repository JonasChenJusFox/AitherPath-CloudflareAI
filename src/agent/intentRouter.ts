export const AGENT_TOOL_NAMES = [
  "searchJobs",
  "listGmailInbox",
  "sendGmailEmail",
  "listTodayCalendarEvents",
  "listCalendarEventsByDate",
  "checkCalendarAvailability",
  "createCalendarEvent",
  "searchGoogleContacts",
  "listGoogleContacts",
  "saveSessionMemory"
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export function selectActiveTools(message: string): AgentToolName[] {
  const text = message.toLowerCase();
  const selected = new Set<AgentToolName>();

  if (
    /\b(job|jobs|internship|internships|role|roles|opening|hiring)\b/.test(text)
  ) {
    selected.add("searchJobs");
  }
  if (/\b(inbox|email|emails|gmail|mail)\b/.test(text)) {
    selected.add("listGmailInbox");
    selected.add("sendGmailEmail");
    selected.add("searchGoogleContacts");
  }
  if (
    /\b(today|tomorrow|schedule|calendar|meeting|event|class|appointment|book|arrange)\b/.test(
      text
    )
  ) {
    selected.add("listTodayCalendarEvents");
    selected.add("listCalendarEventsByDate");
    selected.add("checkCalendarAvailability");
    selected.add("createCalendarEvent");
    selected.add("searchGoogleContacts");
  }
  if (/\b(contact|contacts|phone|email address|who is)\b/.test(text)) {
    selected.add("searchGoogleContacts");
    selected.add("listGoogleContacts");
  }
  if (/\b(remember|save this|save that|keep this|preference)\b/.test(text)) {
    selected.add("saveSessionMemory");
  }

  return selected.size > 0 ? [...selected] : [...AGENT_TOOL_NAMES];
}
