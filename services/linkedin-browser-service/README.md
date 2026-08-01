# LinkedIn browser service

This is a separate local Node.js + Playwright service. Playwright and Chromium are never bundled into the Cloudflare Worker.

## Local setup

```bash
cd services/linkedin-browser-service
npm install
npx playwright install chromium
cp .env.example .env
```

Set a long random token in `.env`. For example:

```bash
openssl rand -base64 32
```

Start the service:

```bash
npm run dev
```

Chromium opens in headed mode. On the first run, manually sign in to LinkedIn and complete any 2FA or CAPTCHA. The service never receives or stores the password. The profile is stored under `.data/linkedin-profile/` and reused on later runs.

## Search the first five Java Engineer jobs

```bash
npm run search -- --keywords "Java Engineer" --limit 5
```

Or use the authenticated HTTP endpoint:

```bash
curl -X POST http://localhost:3001/search \
  -H "Authorization: Bearer YOUR_LOCAL_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keywords":"Java Engineer","limit":5}'
```

If login is missing, the endpoint returns HTTP 409 with `LOGIN_REQUIRED`. The service serializes browser operations so concurrent requests do not launch multiple contexts.

## Worker integration

Set the Worker secret and variable:

```bash
npx wrangler secret put LINKEDIN_BROWSER_API_TOKEN
LINKEDIN_BROWSER_SEARCH_URL=http://localhost:3001
```

The Worker appends `/search` when the variable is a base URL. A deployed Worker cannot normally call `localhost`; production requires deploying this Node service to an authorized Node/container environment or using another approved provider. LinkedIn automation may be restricted by its terms, so this implementation is intended for controlled development/testing with manual user login.
