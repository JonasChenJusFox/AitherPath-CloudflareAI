# WorkingHelper

WorkingHelper is a Cloudflare AI job search agent. Users chat with the assistant, and the agent can call a real job search tool backed by the Jooble API.

The Week 2 foundation adds a Google OAuth and Gmail API integration path. The Gmail account for OAuth testing is `fishlikescat@gmail.com`.

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
│   ├── google/        # Gmail API helpers
│   ├── storage/       # Temporary cookie session helpers for Week 2
│   ├── types/         # Shared TypeScript types
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

## Environment and Secrets

The job search tool needs a Jooble API key. Google OAuth and Gmail API need a Google Cloud OAuth client.

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
GOOGLE_CLIENT_SECRET=GOCSPX-...
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
→ OAuth consent screen
→ Add test user
→ Create OAuth Client ID
→ Application type: Web application
→ Add redirect URI: https://workinghelper.com/auth/google/callback
```

Required OAuth scopes:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
```

Implemented routes:

| Route                       | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `GET /auth/google`          | Redirects the user to Google OAuth           |
| `GET /auth/google/callback` | Exchanges the OAuth code for tokens          |
| `GET /auth/google/logout`   | Clears local Gmail token cookies             |
| `GET /api/gmail/status`     | Checks whether Gmail is configured/connected |
| `GET /api/gmail/inbox`      | Reads recent Gmail inbox messages            |
| `POST /api/gmail/send`      | Sends a plain-text Gmail message             |

Week 2 token storage uses secure HttpOnly cookies for a simple demo. A production version should move refresh tokens into encrypted D1 or KV storage.

Send a test email from the command line after connecting Gmail in the browser:

```bash
WORKINGHELPER_COOKIE='paste_the_workinghelper_cookie_header_here' \
  npm run send:test-email -- recipient@example.com "WorkingHelper test" "Hello from WorkingHelper."
```

The script calls `POST /api/gmail/send`, so it uses the same Gmail OAuth flow as the web app.

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
