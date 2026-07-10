import { ApiError } from "../utils/api";

const PEOPLE_SEARCH_URL =
  "https://people.googleapis.com/v1/people:searchContacts";
const CONTACT_READ_MASK = "names,emailAddresses,phoneNumbers,organizations";

export type ContactSummary = {
  resourceName: string;
  displayName: string;
  emails: string[];
  phoneNumbers: string[];
  organizations: Array<{
    name: string;
    title: string;
  }>;
};

type GooglePerson = {
  resourceName?: string;
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
};

type SearchContactsResponse = {
  results?: Array<{
    person?: GooglePerson;
  }>;
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeContact(person: GooglePerson): ContactSummary {
  return {
    resourceName: person.resourceName || "",
    displayName: person.names?.[0]?.displayName || "(No name)",
    emails: unique(
      (person.emailAddresses || []).map((email) => email.value || "")
    ),
    phoneNumbers: unique(
      (person.phoneNumbers || []).map((phone) => phone.value || "")
    ),
    organizations: (person.organizations || []).map((organization) => ({
      name: organization.name || "",
      title: organization.title || ""
    }))
  };
}

export async function searchContacts(
  accessToken: string,
  query: string,
  pageSize: number
) {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Contact search query is required.",
      400
    );
  }

  const url = new URL(PEOPLE_SEARCH_URL);
  url.searchParams.set("query", cleanQuery);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("readMask", CONTACT_READ_MASK);

  // People API may warm up search indexes on the first request for an account.
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new ApiError(
      "CONTACTS_API_ERROR",
      "Unable to search Google Contacts.",
      response.status === 401 ? 401 : response.status
    );
  }

  const data = await response.json<SearchContactsResponse>();
  return (data.results || [])
    .map((result) => result.person)
    .filter((person): person is GooglePerson => Boolean(person))
    .map(normalizeContact);
}
