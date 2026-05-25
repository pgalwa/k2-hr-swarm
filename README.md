# Hybrid Hunter

Local, zero-auth job-hunting dashboard.

## Setup

```bash
cd hybrid-hunter
npm run install:all
cp .env.example .env
```

Add your Kimi/Moonshot key to `.env`:

```bash
MOONSHOT_API_KEY=sk-your-moonshot-key
MOONSHOT_BASE_URL=https://api.moonshot.ai/v1/chat/completions
KIMI_MODEL=kimi-k2.6
```

Moonshot is the supported path. OpenRouter is not suggested for this app and has not been tested here. In particular, Kimi web-search job discovery depends on Moonshot's built-in `$web_search` tool, so use `MOONSHOT_API_KEY`.

## Run

```bash
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:3001

## Scripts

- `npm run install:all` installs root dependencies, client dependencies, and Playwright Chromium.
- `npm run dev` runs Express and Vite concurrently.
- `npm run server:dev` runs only the local API.
- `npm run client:dev` runs only the Vite client.
- `npm run build` builds the client.
