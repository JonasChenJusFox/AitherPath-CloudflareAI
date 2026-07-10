# WorkingHelper

WorkingHelper is a Cloudflare AI job search agent. Users chat with the assistant, and the agent can call real tools backed by the Jooble and Google APIs.

The Week 3 foundation adds Google Calendar, Google Contacts through People API, and persistent per-user preferences/session memory on top of the completed job search and Gmail features.

## Live URLs

- Current Agent Worker: `https://workinghelper-agent.jonas-aitherpath.workers.dev`
- Production domain: `https://workinghelper.com`

## Tech Stack

- TypeScript
- Cloudflare Workers
- Cloudflare Agents SDK
- Cloudflare Workers AI
- Durable Objects
- React
- Vite
- Jooble API
- Google OAuth2
- Gmail API
- Google Calendar API
- Google People API
- Wrangler
- GitHub Actions

## What This Project Does

The main flow is:

```text
User
→ React chat UI
→ Cloudflare ChatAgent
→ Workers AI model
→ searchJobs tool
→ Jooble API
→ job results
→ AI summary back to user
```

Chat memory is separated by local user and chat session:

```text
Browser local user id
→ Chat review id
→ Agent name: local_user_xxx:chat_xxx
→ Separate Durable Object chat memory
```

The left sidebar stores up to 30 local chat reviews. Each review title opens its own chat window and memory.

The important part is that job search is no longer only a normal HTTP endpoint. It is now an Agent tool. A user can ask naturally:

```text
Find frontend engineer jobs in New York
```

The model can decide to call `searchJobs`, receive job results from Jooble, and summarize them in the chat.

## Project Structure

```text
.
├── src/
│   ├── auth/          # Google OAuth redirect, callback, token exchange
│   ├── google/        # Gmail, Calendar, and People API helpers
│   ├── routes/        # Direct HTTP API routes
│   ├── schemas/       # Zod validation schemas
│   ├── storage/       # Temporary cookie session helpers for Week 2
│   ├── types/         # Shared TypeScript types
│   ├── utils/         # Shared API response and error helpers
│   ├── server.ts      # ChatAgent, Worker routes, tools
│   ├── jobSearch.ts   # Jooble API integration
│   ├── app.tsx        # React chat UI and chat review sidebar
│   ├── client.tsx     # React entry point
│   └── styles.css     # UI styles
├── public/
│   └── favicon.ico
├── wrangler.jsonc     # Cloudflare Worker, AI, Durable Object config
├── package.json
├── tsconfig.json
└── .github/workflows/
    └── ci.yml
```

## Local Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

Run checks:

```bash
npm run check
```

Run tests only:

```bash
npm run test
```

## Environment and Secrets

The job search tool needs a Jooble API key. Google OAuth, Gmail, Calendar, and Contacts need a Google Cloud OAuth client.

For local development, create `.dev.vars`:

```text
JOOBLE_API_KEY=your_jooble_api_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback
```

For Cloudflare production, set these secrets:

```bash
npx wrangler secret put JOOBLE_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
```

For production, `GOOGLE_REDIRECT_URI` should be:

```text
https://workinghelper.com/auth/google/callback
```

Expected Google secret shapes:

```text
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=https://workinghelper.com/auth/google/callback
```

Do not commit `.dev.vars`, `.env`, or API keys.

## Google OAuth Setup

The current Gmail account for OAuth testing is:

```text
fishlikescat@gmail.com
```

Use this account as the Google Cloud Console support email and OAuth test user if it is the account you can access.

Required Google Cloud setup:

```text
Google Cloud Console
→ Create/select project: WorkingHelper
→ Enable Gmail API
→ Enable Google Calendar API
→ Enable People API
→ OAuth consent screen
→ Add test user
→ Create OAuth Client ID
→ Application type: Web application
→ Add redirect URI: https://workinghelper.com/auth/google/callback
```

Required OAuth scopes:

```text
openid
email
profile
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/contacts.readonly
```

If you connected Gmail before Week 3, click `Switch Gmail` once and grant the new Calendar and Contacts scopes.

Implemented routes:

| Route                       | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `GET /auth/google`          | Redirects the user to Google OAuth           |
| `GET /auth/google/callback` | Exchanges the OAuth code for tokens          |
| `GET /auth/google/logout`   | Clears local Gmail token cookies             |
| `GET /api/gmail/status`     | Checks whether Gmail is configured/connected |
| `GET /api/gmail/inbox`      | Reads recent Gmail inbox messages            |
| `POST /api/gmail/send`      | Sends a plain-text Gmail message             |

OAuth tokens are stored in secure HttpOnly cookies for the current demo. Access-token cookies expire slightly before Google's reported expiry so the Worker can refresh before a request fails in transit. A production version should move refresh tokens into encrypted server-side storage.

Send a test email from the command line after connecting Gmail in the browser:

```bash
WORKINGHELPER_COOKIE='paste_the_workinghelper_cookie_header_here' \
  npm run send:test-email -- recipient@example.com "WorkingHelper test" "Hello from WorkingHelper."
```

The script calls `POST /api/gmail/send`, so it uses the same Gmail OAuth flow as the web app.

## Week 3 APIs

Week 3 endpoints are directly callable and require a connected Google session:

| Route                       | Purpose                                     |
| --------------------------- | ------------------------------------------- |
| `GET /api/calendar/today`   | Lists today's Calendar events               |
| `GET /api/calendar/events`  | Lists Calendar events in a date range       |
| `POST /api/calendar/events` | Creates a Calendar event                    |
| `GET /api/contacts/search`  | Searches Google Contacts through People API |
| `GET /api/preferences`      | Reads persistent user preferences           |
| `PATCH /api/preferences`    | Updates persistent user preferences         |
| `GET /api/memory`           | Reads persistent session memory             |
| `POST /api/memory`          | Stores a small memory key/value pair        |

Example Calendar requests:

```bash
curl "https://workinghelper.com/api/calendar/today?timeZone=America/New_York&maxResults=10" \
  -H "Cookie: paste_browser_cookie_header_here"

curl -X POST https://workinghelper.com/api/calendar/events \
  -H "Content-Type: application/json" \
  -H "Cookie: paste_browser_cookie_header_here" \
  -d '{
    "summary": "Project meeting",
    "description": "Weekly project sync",
    "startDateTime": "2026-07-15T14:00:00-04:00",
    "endDateTime": "2026-07-15T15:00:00-04:00",
    "timeZone": "America/New_York",
    "attendeeEmails": ["person@example.com"],
    "sendUpdates": "all"
  }'
```

Example Contacts and memory requests:

```bash
curl "https://workinghelper.com/api/contacts/search?q=Jonas&pageSize=10" \
  -H "Cookie: paste_browser_cookie_header_here"

curl -X PATCH https://workinghelper.com/api/preferences \
  -H "Content-Type: application/json" \
  -H "Cookie: paste_browser_cookie_header_here" \
  -d '{"timeZone":"America/New_York","defaultMeetingDurationMinutes":30}'

curl -X POST https://workinghelper.com/api/memory \
  -H "Content-Type: application/json" \
  -H "Cookie: paste_browser_cookie_header_here" \
  -d '{"key":"job_search_goal","value":"Frontend roles in New York"}'
```

Preferences and memory are stored in the authenticated user's `ChatAgent` Durable Object SQLite storage. Contact search results are not persisted.

## Deployment

Deploy to Cloudflare:

```bash
npm run deploy
```

The deployed Worker uses:

- `ChatAgent` Durable Object for agent state
- `AI` binding for Workers AI
- `JOOBLE_API_KEY` secret for Jooble
- Google OAuth secrets for Gmail API
- Google OAuth scopes for Calendar and People API
- Static assets for the React chat UI

## Custom Domain

The production domain is attached to the `workinghelper-agent` Worker:

```text
Cloudflare Dashboard
→ Workers & Pages
→ workinghelper-agent
→ Settings
→ Domains & Routes
→ Add Custom Domain
→ workinghelper.com
```

If `workinghelper.com` is still attached to the old Worker, remove it from the old Worker first.

## Key Files

### `src/server.ts`

Defines `ChatAgent`, the system prompt, Workers AI model call, and available tools.

Available agent tools:

- `searchJobs`: searches current job postings
- `listGmailInbox`: reads recent Gmail inbox messages
- `sendGmailEmail`: sends a plain-text Gmail message after the user provides a recipient, subject, and body

Week 3 Calendar and Contacts are implemented as direct HTTP APIs first. LLM-driven Calendar/Contacts tool orchestration is intentionally left for later phases.

### `src/jobSearch.ts`

Calls the Jooble API and normalizes results into:

```ts
type JobSummary = {
  title: string;
  company: string;
  location: string;
  link: string;
};
```

### `wrangler.jsonc`

Configures the Worker name, Workers AI binding, Durable Object binding, static assets, and observability.

### `src/auth/googleRoutes.ts`

Defines the Google OAuth routes, callback token exchange, Gmail inbox route, and Gmail send route.

### `src/google/gmail.ts`

Calls Gmail REST APIs with `Authorization: Bearer <access_token>`.
