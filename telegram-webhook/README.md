# Telegram webhook handler

This directory contains the shared server-side handler used by the main Vercel project.

- Main project route: `/api/telegram/webhook`
- Route adapter: `../api/telegram/webhook.ts`
- Handler implementation: `handler.ts`

The handler is deployed together with the main website from the repository root. This directory is not a separate production Vercel project and must not be deployed independently.

## Required server-side environment variables

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_BACKEND_SECRET`
- `TELEGRAM_APPS_SCRIPT_URL`

Do not expose these values to the browser, place them in Git, or send them in chat. See [the integration guide](../docs/TELEGRAM_INTEGRATION.md) for configuration and test requirements.
