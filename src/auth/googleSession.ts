import { getGoogleOAuthConfig, refreshGoogleAccessToken } from "./googleOAuth";
import { getGmailProfile } from "../google/gmail";
import {
  clearGoogleTokenCookies,
  createGoogleTokenCookies,
  getGoogleAccessToken,
  getGoogleRefreshToken
} from "../storage/cookieSession";
import { ApiError } from "../utils/api";

export type GoogleSession = {
  accessToken: string;
  email: string;
  cookies: string[];
};

export async function getGoogleSession(
  request: Request,
  env: Env
): Promise<GoogleSession | null> {
  const config = getGoogleOAuthConfig(env);
  if (!config) return null;

  let accessToken = getGoogleAccessToken(request);
  const cookies: string[] = [];

  if (!accessToken) {
    const refreshToken = getGoogleRefreshToken(request);
    if (!refreshToken) return null;

    try {
      const refreshed = await refreshGoogleAccessToken(config, refreshToken);
      accessToken = refreshed.access_token;
      cookies.push(...createGoogleTokenCookies(refreshed));
    } catch {
      cookies.push(...clearGoogleTokenCookies());
      throw new ApiError(
        "REAUTHORIZATION_REQUIRED",
        "Google authorization expired. Please log in again.",
        401
      );
    }
  }

  try {
    const profile = await getGmailProfile(accessToken);
    return {
      accessToken,
      email: profile.emailAddress,
      cookies
    };
  } catch {
    cookies.push(...clearGoogleTokenCookies());
    throw new ApiError(
      "REAUTHORIZATION_REQUIRED",
      "Google authorization expired. Please log in again.",
      401
    );
  }
}

export function appendCookies(response: Response, cookies: string[]) {
  for (const cookie of cookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}
