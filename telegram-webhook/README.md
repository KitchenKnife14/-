# Telegram webhook endpoint

This directory is the standalone Vercel project for the Telegram webhook.

## Vercel project settings

- Project name: `budget-for-two-telegram-api`
- Repository: `KitchenKnife14/-`
- Root Directory: `telegram-webhook`
- Framework Preset: Other
- Build Command: `npm run build` (a no-op script is included so Vercel's default build does not fail). Install Command: `npm install --ignore-scripts`. Output Directory: empty.
- Vercel Authentication: disabled for this endpoint-only project
- This is an endpoint-only project. A Production deployment is acceptable here because it is isolated from the website; do not attach the family-budget website domain.

## Required server-side environment variables

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_BACKEND_SECRET`
- `TELEGRAM_APPS_SCRIPT_URL`

Do not expose these values to the browser, place them in Git, or send them in chat.

The stable webhook URL is `https://budget-for-two-telegram-api-nikita-aa7c.vercel.app/api/telegram/webhook` after the dedicated project's Production deployment is READY. The function is served at `/api/telegram/webhook`. The implementation lives in `handler.ts` and is shared with the main repository endpoint at `api/telegram/webhook.ts`.
