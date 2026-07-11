import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleOAuthConfig,
  PLACEHOLDER_EMAIL,
  refreshGoogleAccessToken
} from "./googleOAuth";
import {
  getGmailProfile,
  listInboxMessages,
  sendGmailMessage
} from "../google/gmail";
import {
  clearGoogleTokenCookies,
  clearOAuthStateCookie,
  createGoogleTokenCookies,
  createOAuthStateCookie,
  getGoogleAccessToken,
  getGoogleRefreshToken,
  getOAuthState
} from "../storage/cookieSession";
import type { SendEmailInput } from "../types/google";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function getMissingGoogleConfigResponse() {
  return json(
    {
      error: "Google OAuth is not configured yet.",
      placeholderEmail: PLACEHOLDER_EMAIL,
      requiredSecrets: [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REDIRECT_URI"
      ],
      redirectUriExample: "https://workinghelper.com/auth/google/callback"
    },
    { status: 501 }
  );
}

function getInvalidOAuthStateResponse() {
  const response = json(
    {
      error: "Invalid Google OAuth callback state.",
      message:
        "The Google login was started from a different browser profile, expired, or was restarted in another tab. Open WorkingHelper and click Connect Gmail again in the same browser profile."
    },
    { status: 400 }
  );
  response.headers.append("Set-Cookie", clearOAuthStateCookie());
  return response;
}

async function getUsableAccessToken(request: Request, env: Env) {
  const accessToken = getGoogleAccessToken(request);
  if (accessToken) {
    return { accessToken, cookies: [] };
  }

  const refreshToken = getGoogleRefreshToken(request);
  const config = getGoogleOAuthConfig(env);

  if (!refreshToken || !config) {
    return null;
  }

  const tokens = await refreshGoogleAccessToken(config, refreshToken);
  return {
    accessToken: tokens.access_token,
    cookies: createGoogleTokenCookies(tokens)
  };
}

function withCookies(response: Response, cookies: string[]) {
  for (const cookie of cookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

function getGoogleConnectedPage(homeUrl: string) {
  const safeHomeUrl = homeUrl.replace(/"/g, "&quot;");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="1; url=${safeHomeUrl}" />
    <title>Gmail Connected</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #111827;
      }

      main {
        width: min(90vw, 420px);
        padding: 32px;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        background: white;
        box-shadow: 0 20px 50px rgb(15 23 42 / 8%);
      }

      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }

      p {
        margin: 0 0 20px;
        line-height: 1.5;
        color: #4b5563;
      }

      a {
        color: #2563eb;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Gmail connected</h1>
      <p>Returning to WorkingHelper...</p>
      <a href="${safeHomeUrl}">Go back now</a>
    </main>
  </body>
</html>`;
}

export async function handleGoogleRoutes(request: Request, env: Env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/gmail/status") {
    const configured = Boolean(getGoogleOAuthConfig(env));

    if (!configured) {
      return json({
        configured,
        connected: false,
        placeholderEmail: PLACEHOLDER_EMAIL
      });
    }

    const auth = await getUsableAccessToken(request, env);
    if (!auth) {
      return json({
        configured,
        connected: false,
        placeholderEmail: PLACEHOLDER_EMAIL
      });
    }

    try {
      const profile = await getGmailProfile(auth.accessToken);
      return withCookies(
        json({
          configured,
          connected: true,
          email: profile.emailAddress,
          placeholderEmail: PLACEHOLDER_EMAIL
        }),
        auth.cookies
      );
    } catch {
      const response = json({
        configured,
        connected: false,
        placeholderEmail: PLACEHOLDER_EMAIL
      });
      return withCookies(response, clearGoogleTokenCookies());
    }
  }

  if (url.pathname === "/auth/google") {
    const config = getGoogleOAuthConfig(env);
    if (!config) return getMissingGoogleConfigResponse();

    // State binds the callback to this browser session and helps prevent CSRF.
    const state = crypto.randomUUID();
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: buildGoogleAuthUrl(config, state)
      }
    });
    response.headers.append("Set-Cookie", createOAuthStateCookie(state));
    return response;
  }

  if (url.pathname === "/auth/google/callback") {
    const config = getGoogleOAuthConfig(env);
    if (!config) return getMissingGoogleConfigResponse();

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const savedState = getOAuthState(request);

    // Reject callbacks that do not match the state created before redirecting.
    if (!code || !state || state !== savedState) {
      return getInvalidOAuthStateResponse();
    }

    const tokens = await exchangeCodeForTokens(config, code);
    const homeUrl = `${url.origin}/`;
    const response = new Response(getGoogleConnectedPage(homeUrl), {
      headers: {
        "Content-Type": "text/html; charset=UTF-8"
      }
    });

    for (const cookie of [
      clearOAuthStateCookie(),
      ...createGoogleTokenCookies(tokens)
    ]) {
      response.headers.append("Set-Cookie", cookie);
    }

    return response;
  }

  if (url.pathname === "/auth/google/logout") {
    const response = json({ ok: true });
    return withCookies(response, clearGoogleTokenCookies());
  }

  if (url.pathname === "/api/gmail/inbox") {
    const auth = await getUsableAccessToken(request, env);
    if (!auth) {
      return json(
        {
          error: "Gmail is not connected. Visit /auth/google first.",
          placeholderEmail: PLACEHOLDER_EMAIL
        },
        { status: 401 }
      );
    }

    const messages = await listInboxMessages(auth.accessToken);
    return withCookies(json({ messages }), auth.cookies);
  }

  if (url.pathname === "/api/gmail/send" && request.method === "POST") {
    const auth = await getUsableAccessToken(request, env);
    if (!auth) {
      return json(
        {
          error: "Gmail is not connected. Visit /auth/google first.",
          placeholderEmail: PLACEHOLDER_EMAIL
        },
        { status: 401 }
      );
    }

    const input = await request.json<Partial<SendEmailInput>>();

    if (!input.to || !input.subject || !input.body) {
      return json(
        { error: "Send email requires to, subject, and body." },
        { status: 400 }
      );
    }

    const result = await sendGmailMessage(auth.accessToken, {
      to: input.to,
      subject: input.subject,
      body: input.body
    });

    return withCookies(json({ sent: true, result }), auth.cookies);
  }

  return null;
}
