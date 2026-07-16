# AitherPath AI Assistant Agent

**AitherPath AI Assistant Agent** is AitherPath's AI career copilot built on Cloudflare. Users chat with the assistant to find current opportunities and coordinate the communication, calendar events, contacts, and preferences around their job search. The agent calls real tools backed by the Jooble and Google APIs.

- Product: **AitherPath AI Assistant Agent**
- Company: **AitherPath**
- Repository: **AitherPath-CloudflareAI**

Week 4 adds OpenAI as the primary model provider, a typed modular tool registry, bounded multi-step tool execution, and server-enforced approval for email and calendar writes. The existing Workers AI provider remains available as an explicit fallback.

## Deployment URLs

- Agent Worker: `https://workinghelper-agent.jonas-aitherpath.workers.dev`
- Production domain: `https://workinghelper.com`

The repository, Worker name, and production domain intentionally keep their existing technical identifiers. AitherPath AI Assistant Agent is the user-facing product name.

## Tech Stack

- TypeScript
- Cloudflare Workers
- Cloudflare Agents SDK
- Cloudflare Workers AI
- OpenAI API
- Vercel AI SDK OpenAI provider
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
→ OpenAI model (or configured Workers AI fallback)
→ typed tool selection
→ Zod input validation
→ approval gate for external writes
→ Jooble or Google API
→ structured tool result
→ final streamed response
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
│   ├── agent/         # Model provider, prompt, intent routing, tools, confirmation
│   ├── auth/          # Google OAuth redirect, callback, token exchange
│   ├── google/        # Gmail, Calendar, and People API helpers
│   ├── routes/        # Direct HTTP API routes
│   ├── schemas/       # Zod validation schemas
│   ├── storage/       # Temporary cookie session helpers for Week 2
│   ├── types/         # Shared TypeScript types
│   ├── utils/         # Shared API response and error helpers
│   ├── server.ts      # ChatAgent composition, storage, and Worker routes
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

## Model Provider Configuration

OpenAI is the default Week 4 provider. `OPENAI_API_KEY` is read only by the Worker and must never be exposed to React, placed in `wrangler.jsonc`, or committed.

Local `.dev.vars` configuration:

```text
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.4-mini
LLM_PROVIDER=openai
```

Production secret:

```bash
npx wrangler secret put OPENAI_API_KEY
```

`OPENAI_MODEL` and `LLM_PROVIDER` are non-secret variables configured in `wrangler.jsonc`. Supported provider values are:

- `openai`: requires `OPENAI_API_KEY`; no silent fallback occurs after OpenAI authentication, billing, rate-limit, or provider failures.
- `workers-ai`: uses the existing Cloudflare `AI` binding and `@cf/moonshotai/kimi-k2.6`.

Both providers use the same system prompt, active-tool routing, typed registry, validation, step limit, and approval mechanism.

## Environment and Secrets

The job search tool needs a Jooble API key. Google OAuth, Gmail, Calendar, and Contacts need a Google Cloud OAuth client.

For local development, copy `.dev.vars.example` to the ignored `.dev.vars` file and fill in local values:

```text
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.4-mini
LLM_PROVIDER=openai
JOOBLE_API_KEY=your_jooble_api_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback
```

For Cloudflare production, set these secrets:

```bash
npx wrangler secret put OPENAI_API_KEY
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
→ Create/select project: AitherPath AI Assistant Agent
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
  npm run send:test-email -- recipient@example.com "AitherPath AI Assistant Agent test" "Hello from AitherPath AI Assistant Agent."
```

The script calls `POST /api/gmail/send`, so it uses the same Gmail OAuth flow as the web app.

## Week 4 Agent Tools

The LLM can call only tools registered in `src/agent/toolRegistry.ts`. Each tool has a bounded Zod schema, input normalization, a focused description, and a structured success or safe error result.

Read-only tools:

- `searchJobs`
- `listGmailInbox`
- `listTodayCalendarEvents`
- `listCalendarEventsByDate`
- `listGoogleContacts`
- `searchGoogleContacts`

State-changing tools:

- `sendGmailEmail` — always requires approval
- `createCalendarEvent` — always requires approval
- `saveSessionMemory` — requires an explicit request to remember, but not a second approval

Calendar and Contacts are available through both the existing direct HTTP APIs and LLM-driven Agent tools.

### Confirmation Flow

Email sending and calendar creation use AI SDK tool approval plus a Durable Object confirmation record:

```text
Model proposes a complete write action
→ server validates and normalizes arguments
→ pending action is stored for the current ChatAgent session
→ UI shows recipient/event, dates, time zone, and other relevant fields
→ user chooses Confirm action or Cancel
→ approved tool call must match the stored tool name and exact arguments
→ action executes at most once
→ provider result returns to the model
→ model streams the final user-facing result
```

Pending confirmations expire after 10 minutes. A changed action cancels the older preview, records are isolated by chat session, and completed or retried approvals cannot execute the write twice. Read-only tools execute without confirmation.

Relative calendar dates are resolved using the saved user time zone. Calendar writes require RFC3339 timestamps with offsets, a valid IANA time zone, and an end time after the start time.

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
- OpenAI API as the default LLM provider
- `AI` binding for the optional Workers AI fallback
- `OPENAI_API_KEY` secret for OpenAI
- `JOOBLE_API_KEY` secret for Jooble
- Google OAuth secrets for Gmail API
- Google OAuth scopes for Calendar and People API
- Static assets for the React chat UI

## Custom Domain

The production domain remains attached to the existing `workinghelper-agent` Worker:

```text
Cloudflare Dashboard
→ Workers & Pages
→ workinghelper-agent
→ Settings
→ Domains & Routes
→ Add Custom Domain
→ workinghelper.com
```

No Worker or domain migration is required for this product rebrand.

## Key Files

### `src/server.ts`

Composes `ChatAgent`, Durable Object storage, pending approvals, auth synchronization, and Worker routes.

### `src/agent/`

Contains the OpenAI/Workers AI provider factory, system-prompt builder, intent-based active-tool selection, typed registry, tool modules, safe errors, time-zone helpers, and confirmation state machine.

Available agent tools:

- `searchJobs`: searches current job postings
- `listGmailInbox`: reads recent Gmail inbox messages
- `sendGmailEmail`: sends a plain-text Gmail message after the user provides a recipient, subject, and body
- `listTodayCalendarEvents`: reads today's Calendar events in the user's time zone
- `listCalendarEventsByDate`: reads Calendar events for a resolved date
- `createCalendarEvent`: creates an approved Calendar event
- `searchGoogleContacts`: searches a connected Google Contacts account
- `listGoogleContacts`: lists Google Contacts
- `saveSessionMemory`: saves an explicitly requested stable preference or goal

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

## Verification

Run the same checks used by CI:

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm run check
```

`npm run build` temporarily moves `.dev.vars` outside the project while Vite builds, then restores it. This prevents local secrets from being copied into `dist`.

## Security Notes and Current Limitations

- OpenAI and Google credentials remain server-side. Tool results never contain API keys, OAuth tokens, cookies, or raw provider error bodies.
- OpenAI Responses storage is disabled by provider options.
- Reasoning output is not sent to the browser.
- Agent email/calendar writes require approval. The existing direct HTTP write APIs remain available for authenticated trusted clients and do not use the chat approval UI.
- OAuth tokens are still stored in secure HttpOnly cookies for this demo. A production hardening phase should move refresh tokens to encrypted server-side storage.
- The pending-action table provides short-lived confirmation and duplicate prevention; it is not a Week 5 Cloudflare Workflow.
- The UI supports image attachments, but tool inputs and provider support determine how an image is used.
