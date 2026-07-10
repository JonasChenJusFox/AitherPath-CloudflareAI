import type { GoogleTokenResponse } from "../types/google";

const ACCESS_TOKEN_COOKIE = "wh_google_access_token";
const REFRESH_TOKEN_COOKIE = "wh_google_refresh_token";
const OAUTH_STATE_COOKIE = "wh_google_oauth_state";
const ONE_HOUR = 60 * 60;
const TOKEN_REFRESH_BUFFER_SECONDS = 60;
const THIRTY_DAYS = 30 * 24 * 60 * 60;

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function createCookie(name: string, value: string, maxAgeSeconds: number) {
  // HttpOnly keeps OAuth tokens out of frontend JavaScript.
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ].join("; ");
}

function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getOAuthState(request: Request) {
  return readCookie(request, OAUTH_STATE_COOKIE);
}

export function createOAuthStateCookie(state: string) {
  return createCookie(OAUTH_STATE_COOKIE, state, 10 * 60);
}

export function clearOAuthStateCookie() {
  return clearCookie(OAUTH_STATE_COOKIE);
}

export function getGoogleAccessToken(request: Request) {
  return readCookie(request, ACCESS_TOKEN_COOKIE);
}

export function getGoogleRefreshToken(request: Request) {
  return readCookie(request, REFRESH_TOKEN_COOKIE);
}

export function createGoogleTokenCookies(tokens: GoogleTokenResponse) {
  const cookies = [
    createCookie(
      ACCESS_TOKEN_COOKIE,
      tokens.access_token,
      Math.max(
        Math.min(tokens.expires_in || ONE_HOUR, ONE_HOUR) -
          TOKEN_REFRESH_BUFFER_SECONDS,
        60
      )
    )
  ];

  if (tokens.refresh_token) {
    // Preserve the existing refresh token when Google omits one on later exchanges.
    cookies.push(
      createCookie(REFRESH_TOKEN_COOKIE, tokens.refresh_token, THIRTY_DAYS)
    );
  }

  return cookies;
}

export function clearGoogleTokenCookies() {
  return [clearCookie(ACCESS_TOKEN_COOKIE), clearCookie(REFRESH_TOKEN_COOKIE)];
}
