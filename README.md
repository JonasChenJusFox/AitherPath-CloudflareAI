# Cloudflare AI Assistant Agent

A beginner-friendly TypeScript backend for an AI assistant portfolio project.

Week 1 focuses on a clean Cloudflare Workers foundation: API design, project structure, local development, and deployment readiness.

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
│   │   └── chat.ts
│   ├── middleware/
│   │   └── logger.ts
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
├── .gitignore
└── .env.example
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

Echoes the message for Week 1.

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
```

You can also open `http://localhost:8787` in a browser and test the chat form.

## Week 1 Completion Checklist

- [x] TypeScript Cloudflare Workers project structure
- [x] Hono routing setup
- [x] Health endpoint
- [x] Hello endpoint
- [x] Chat endpoint with validation
- [x] Logging middleware
- [x] Global error handler
- [x] Simple frontend test page
- [x] Wrangler configuration
- [x] Environment variable example file
