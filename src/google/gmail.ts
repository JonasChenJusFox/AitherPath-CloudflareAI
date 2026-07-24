import type {
  GmailMessageSummary,
  GmailProfile,
  SendEmailInput
} from "../types/google";
import { ApiError } from "../utils/api";

type GmailListResponse = {
  messages?: Array<{
    id: string;
    threadId: string;
  }>;
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: {
    headers?: Array<{
      name: string;
      value: string;
    }>;
  };
};

function getHeader(message: GmailMessageResponse, name: string) {
  const header = message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value || "";
}

async function gmailFetch<T>(
  accessToken: string,
  url: string,
  init?: RequestInit
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(
        "REAUTHORIZATION_REQUIRED",
        "Google authorization expired. Please log in again.",
        401
      );
    }
    throw new ApiError(
      "GMAIL_API_ERROR",
      "Unable to communicate with Gmail.",
      response.status
    );
  }

  return response.json<T>();
}

export async function listInboxMessages(
  accessToken: string,
  maxResults = 10
): Promise<GmailMessageSummary[]> {
  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages"
  );
  listUrl.searchParams.set("labelIds", "INBOX");
  listUrl.searchParams.set("maxResults", String(maxResults));

  const list = await gmailFetch<GmailListResponse>(
    accessToken,
    listUrl.toString()
  );

  const messages = await Promise.all(
    (list.messages || []).map((message) => {
      const detailUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`
      );
      detailUrl.searchParams.set("format", "metadata");
      detailUrl.searchParams.set("metadataHeaders", "Subject");
      detailUrl.searchParams.append("metadataHeaders", "From");
      detailUrl.searchParams.append("metadataHeaders", "Date");
      return gmailFetch<GmailMessageResponse>(
        accessToken,
        detailUrl.toString()
      );
    })
  );

  return messages.map((message) => ({
    id: message.id,
    threadId: message.threadId,
    subject: getHeader(message, "Subject") || "(No subject)",
    from: getHeader(message, "From") || "(Unknown sender)",
    date: getHeader(message, "Date"),
    snippet: message.snippet || ""
  }));
}

export async function getGmailProfile(
  accessToken: string
): Promise<GmailProfile> {
  return gmailFetch<GmailProfile>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/profile"
  );
}

function toBase64Url(value: string) {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function sendGmailMessage(
  accessToken: string,
  input: SendEmailInput
) {
  const mimeMessage = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.body
  ].join("\r\n");

  return gmailFetch<{ id: string; threadId: string }>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        raw: toBase64Url(mimeMessage)
      })
    }
  );
}
