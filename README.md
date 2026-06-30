# Cloudflare AI Assistant Agent

[![CI](https://github.com/JonasChenJusFox/AitherPath-CloudflareAI/actions/workflows/ci.yml/badge.svg)](https://github.com/JonasChenJusFox/AitherPath-CloudflareAI/actions/workflows/ci.yml)

A beginner-friendly TypeScript backend for an AI assistant portfolio project.

Week 1 focuses on TypeScript, Cloudflare Workers, Hono routing, HTTP basics, deployment, secrets, and a small job search integration.

## Tech Stack

- TypeScript
- Cloudflare Workers
- Hono
- Wrangler
- Node.js and npm
- Plain HTML, CSS, and JavaScript for the simple test page

## Folder Structure

```text
.
├── src/
│   ├── index.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── hello.ts
│   │   ├── chat.ts
│   │   └── jobs.ts
│   ├── middleware/
│   │   └── logger.ts
│   ├── services/
│   │   └── jobSearch.ts
│   ├── types/
│   │   └── app.ts
│   └── utils/
│       └── response.ts
├── public/
│   └── index.html
├── README.md
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── .gitignore
```

## Install Dependencies

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

The local app runs at:

```text
http://localhost:8787
```

Open that URL in a browser to use the simple chat test page.

## Deploy to Cloudflare Workers

Log in to Cloudflare if needed:

```bash
npx wrangler login
```

Deploy:

```bash
npm run deploy
```

## Secrets

Job search uses the `JOOBLE_API_KEY` secret. Do not commit API keys.

For local development, create a local `.dev.vars` file:

```text
JOOBLE_API_KEY=your_jooble_api_key_here
```

For production, store the key in Cloudflare:

```bash
npx wrangler secret put JOOBLE_API_KEY
```

Do not commit local `.env`, `.dev.vars`, or `.env.example` files.

## Week 1 Study Notes

- ReAct is the paper reference for future agent design: reason about the next step, act with a tool, observe the result, and repeat.
- The Cloudflare Agents Starter template is useful to study locally:

```bash
npx create-cloudflare@latest --template cloudflare/agents-starter
```

This repository keeps Week 1 smaller: a Worker API, simple routes, middleware, deployment setup, and one job-search tool endpoint.

## API Endpoints

### GET /health

Returns basic service status.

```bash
curl http://localhost:8787/health
```

Example response:

```json
{
  "status": "ok",
  "service": "cloudflare-ai-assistant",
  "week": 1
}
```

### GET /hello

Returns a friendly greeting.

```bash
curl "http://localhost:8787/hello?name=Jonas"
```

Example response:

```json
{
  "message": "Hello, Jonas!"
}
```

Without a name:

```bash
curl http://localhost:8787/hello
```

Example response:

```json
{
  "message": "Hello, guest!"
}
```

### POST /chat

Echoes a normal message for Week 1.

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

Example response:

```json
{
  "reply": "You said: hello"
}
```

You can also search jobs through the chat route:

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"jobs frontend engineer in New York"}'
```

Invalid input returns a 400 response:

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{}'
```

Example response:

```json
{
  "error": "Message is required and must be a non-empty string."
}
```

### POST /jobs

Searches jobs with the configured Jooble API key.

```bash
curl -X POST http://localhost:8787/jobs \
  -H "Content-Type: application/json" \
  -d '{"keywords":"frontend engineer","location":"New York"}'
```

Example response:

```json
{
  "jobs": [
    {
      "title": "Frontend Engineer",
      "company": "Example Company",
      "location": "New York",
      "link": "https://example.com/job"
    }
  ]
}
```

If `JOOBLE_API_KEY` is missing, the endpoint returns a 503 setup error.

## Commands From Zero

```bash
npm install
npm run dev
```

## Git Commands

```bash
git init
git add .
git commit -m "Initial Cloudflare AI assistant Week 1 foundation"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cloudflare-ai-assistant.git
git push -u origin main
```

## Cloudflare Deployment Command

```bash
npm run deploy
```

## Local Testing Checklist

Start the local server:

```bash
npm run dev
```

Then test:

```bash
curl http://localhost:8787/health
curl "http://localhost:8787/hello?name=Jonas"
curl http://localhost:8787/hello
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{}'
curl -X POST http://localhost:8787/jobs \
  -H "Content-Type: application/json" \
  -d '{"keywords":"frontend engineer","location":"New York"}'
```

You can also open `http://localhost:8787` in a browser and test the chat form.
