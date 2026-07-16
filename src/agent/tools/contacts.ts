import { tool } from "ai";
import { z } from "zod";
import { listContacts, searchContacts } from "../../google/contacts";
import { ApiError } from "../../utils/api";
import { safeToolExecution } from "../toolErrors";
import type { AgentToolContext } from "../types";

export const searchContactsToolSchema = z
  .object({
    query: z.string().trim().min(1).max(120),
    pageSize: z.number().int().min(1).max(10).optional()
  })
  .strict();

export const listContactsToolSchema = z
  .object({
    pageSize: z.number().int().min(1).max(20).optional()
  })
  .strict();

async function requireGoogleToken(context: AgentToolContext) {
  const token = await context.getGoogleAccessToken();
  if (!token) {
    throw new ApiError(
      "AUTHENTICATION_REQUIRED",
      "Google is not connected.",
      401
    );
  }
  return token;
}

export function createContactsTools(context: AgentToolContext) {
  return {
    searchGoogleContacts: tool({
      description:
        "Search the connected user's Google Contacts by name, email, company, phone text, or keyword when the user needs a person's actual contact record. Do not use it for broad inbox searches and never guess missing contact information. This is read-only. Return all matches when the result is ambiguous.",
      inputSchema: searchContactsToolSchema,
      execute: async ({ query, pageSize }) =>
        safeToolExecution(
          async () => ({
            query,
            contacts: await searchContacts(
              await requireGoogleToken(context),
              query,
              pageSize ?? 10
            )
          }),
          "Google Contacts could not be searched. Please reconnect Google or try again."
        )
    }),

    listGoogleContacts: tool({
      description:
        "List the connected user's Google Contacts when the user asks who is in the contact list without naming a specific person. Do not use it to search Gmail or infer relationships. This is read-only.",
      inputSchema: listContactsToolSchema,
      execute: async ({ pageSize }) =>
        safeToolExecution(
          async () => ({
            contacts: await listContacts(
              await requireGoogleToken(context),
              pageSize ?? 10
            )
          }),
          "Google Contacts could not be listed. Please reconnect Google or try again."
        )
    })
  };
}
