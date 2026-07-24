import type {
  GoogleIdentity,
  GoogleOAuthConfig,
  GoogleTokenResponse
} from "../types/google";

export const PLACEHOLDER_EMAIL = "fishlikescat@gmail.com";

const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/contacts.readonly"
];

export function getGoogleOAuthConfig(env: Env): GoogleOAuthConfig | null {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return null;
  }

  if (!env.GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com")) {
    return null;
  }

  try {
    const redirectUri = new URL(env.GOOGLE_REDIRECT_URI);
    if (!["http:", "https:"].includes(redirectUri.protocol)) return null;
    if (!redirectUri.pathname.endsWith("/auth/google/callback")) return null;
  } catch {
    return null;
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI
  };
}

export function buildGoogleAuthUrl(config: GoogleOAuthConfig, state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error("Google token exchange failed.");
  }

  return response.json<GoogleTokenResponse>();
}

export async function refreshGoogleAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error("Google token refresh failed.");
  }

  return response.json<GoogleTokenResponse>();
}

/**
 * Returns Google's stable OpenID subject for the authenticated account.
 * The subject is safer than an email address and must be resolved server-side.
 */
export async function getGoogleIdentity(
  accessToken: string
): Promise<GoogleIdentity | null> {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  if (!response.ok) return null;

  const identity = await response.json<GoogleIdentity>();
  return identity.sub?.trim() ? identity : null;
}
