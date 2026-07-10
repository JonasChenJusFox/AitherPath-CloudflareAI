import { ApiError } from "../utils/api";

const PEOPLE_SEARCH_URL =
  "https://people.googleapis.com/v1/people:searchContacts";
const PEOPLE_CONNECTIONS_URL =
  "https://people.googleapis.com/v1/people/me/connections";
const CONTACT_READ_MASK = "names,emailAddresses,phoneNumbers,organizations";
const CONTACT_LIST_LIMIT = 200;

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

type ListConnectionsResponse = {
  connections?: GooglePerson[];
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

function contactSearchText(contact: ContactSummary) {
  return [
    contact.displayName,
    ...contact.emails,
    ...contact.phoneNumbers,
    ...contact.organizations.flatMap((organization) => [
      organization.name,
      organization.title
    ])
  ]
    .join(" ")
    .toLowerCase();
}

function matchesContact(contact: ContactSummary, query: string) {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const searchText = contactSearchText(contact);
  return tokens.every((token) => searchText.includes(token));
}

function uniqueContacts(contacts: ContactSummary[]) {
  const seen = new Set<string>();

  return contacts.filter((contact) => {
    const key =
      contact.resourceName ||
      contact.emails[0] ||
      `${contact.displayName}:${contact.phoneNumbers[0] || ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export async function listContacts(accessToken: string, pageSize: number) {
  const url = new URL(PEOPLE_CONNECTIONS_URL);
  url.searchParams.set("pageSize", String(Math.min(pageSize, 1000)));
  url.searchParams.set("personFields", CONTACT_READ_MASK);
  url.searchParams.set("sortOrder", "FIRST_NAME_ASCENDING");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new ApiError(
      "CONTACTS_API_ERROR",
      "Unable to list Google Contacts.",
      response.status === 401 ? 401 : response.status
    );
  }

  const data = await response.json<ListConnectionsResponse>();
  return (data.connections || []).map(normalizeContact);
}

async function searchGoogleContactsIndex(
  accessToken: string,
  query: string,
  pageSize: number
) {
  const url = new URL(PEOPLE_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("readMask", CONTACT_READ_MASK);

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

  // Google's search index can lag after a user adds a contact. Reading the
  // connections list first makes recently created contacts available sooner.
  const listedMatches = (await listContacts(accessToken, CONTACT_LIST_LIMIT))
    .filter((contact) => matchesContact(contact, cleanQuery))
    .slice(0, pageSize);

  if (listedMatches.length > 0) {
    return listedMatches;
  }

  const indexedMatches = await searchGoogleContactsIndex(
    accessToken,
    cleanQuery,
    pageSize
  );

  return uniqueContacts([...listedMatches, ...indexedMatches]).slice(
    0,
    pageSize
  );
}
