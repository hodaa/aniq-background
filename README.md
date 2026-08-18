# ANIQ Cron Worker

This Worker is only a scheduler. It calls the authenticated cron endpoints hosted by the ANIQ backend.

## Local setup

```bash
npm install
npx wrangler login
npx wrangler secret put CRON_SECRET
npm run dev
```

For local development, create `.dev.vars` with `CRON_SECRET=...` and never commit it.

## Deploy

```bash
npm run typecheck
npm run deploy
```

`BACKEND_URL` is configured in `wrangler.jsonc`. The cron schedules use UTC.
