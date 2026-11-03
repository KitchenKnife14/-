# Telegram webhook endpoint

This directory is the standalone Vercel project for the Telegram webhook.

## Vercel project settings

- Project name: `budget-for-two-telegram-api`
- Repository: `KitchenKnife14/-`
- Root Directory: `telegram-webhook`
- Framework Preset: Other
- Build Command, Install Command, Output Directory: empty
- Vercel Authentication: disabled for this endpoint-only project
- Use Preview deployments only; do not promote to Production or attach the family-budget website domain.

## Required server-side environment variables

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_BACKEND_SECRET`
- `TELEGRAM_APPS_SCRIPT_URL`

Do not expose these values to the browser, place them in Git, or send them in chat.

The function is served at `/api/telegram/webhook`. The implementation lives in `handler.ts` and is shared with the main repository endpoint at `api/telegram/webhook.ts`.
