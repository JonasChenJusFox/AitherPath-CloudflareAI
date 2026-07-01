# WorkingHelper

WorkingHelper is a Cloudflare AI job search agent. Users chat with the assistant, and the agent can call a real job search tool backed by the Jooble API.

This repository is based on Cloudflare's Agents architecture and focuses on one main Week 1 feature: an AI chat agent that can call a real job search tool.

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

The important part is that job search is no longer only a normal HTTP endpoint. It is now an Agent tool. A user can ask naturally:

```text
Find frontend engineer jobs in New York
```

The model can decide to call `searchJobs`, receive job results from Jooble, and summarize them in the chat.

## Project Structure

```text
.
├── src/
│   ├── server.ts      # ChatAgent, Workers AI call, tools
│   ├── jobSearch.ts   # Jooble API integration
│   ├── app.tsx        # React chat UI
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

The job search tool needs a Jooble API key.

For local development, create `.dev.vars`:

```text
JOOBLE_API_KEY=your_jooble_api_key
```

For Cloudflare production, set the secret:

```bash
npx wrangler secret put JOOBLE_API_KEY
```

Do not commit `.dev.vars`, `.env`, or API keys.

## Deployment

Deploy to Cloudflare:

```bash
npm run deploy
```

The deployed Worker uses:

- `ChatAgent` Durable Object for agent state
- `AI` binding for Workers AI
- `JOOBLE_API_KEY` secret for Jooble
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

## Status

- Basic Agent chat: complete
- Jooble job search tool: complete
- Cloudflare deploy: complete
- Custom domain migration: complete
- User auth and per-user memory isolation: future work
