# Telegram integration

## Architecture

Telegram is an additional interface to the existing family-budget backend. It must not write to Google Sheets directly and must not bypass Apps Script authorization or family-isolation rules.

1. Telegram sends updates to the Vercel endpoint `/api/telegram/webhook` on the **main family-budget Vercel project**.
2. The Vercel function validates Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
3. Vercel forwards the update to the existing Apps Script Web App using a separate server-to-server secret.
4. Apps Script maps the Telegram user ID to one linked application user and checks that the user is still a member of the linked family.
5. Apps Script writes transactions through the same validation path as the web application.
6. Vercel sends the returned text to Telegram using the bot token.

The webhook route is implemented by `api/telegram/webhook.ts` and the shared handler in `telegram-webhook/handler.ts`. The `telegram-webhook` directory is shared source code; it is not a separate production website project.

The Telegram bot token and both webhook secrets are server-side environment/script properties only. Never add them to `VITE_*` variables, frontend code, Git, screenshots, or chat messages.

## Public bot

- Telegram username: `@My_Family_cash_bot`.
- Start the bot: https://t.me/My_Family_cash_bot.

## Current implementation

- One-time linking code generation via Apps Script RPC `create_telegram_link_code`.
- Codes are stored as SHA-256 hashes, contain 12 characters, and expire after 15 minutes.
- A Telegram account can be linked to only one app account; an app account can have only one Telegram link.
- Apps Script webhook authentication via Script Property `TELEGRAM_BACKEND_SECRET`.
- Vercel webhook endpoint at `/api/telegram/webhook` on the main project.
- Commands: `/start`, `/help`, `/link CODE`, `/unlink`, `/balance`.
- Initial text transaction flow, e.g. `Проезд 45 рублей`.
- The handler uses the linked user's family membership and existing transaction validation.
- Telegram update IDs are cached in Apps Script properties to reduce duplicate writes when Telegram retries a webhook delivery.

## Main Vercel project

Use the existing Vercel project **`-`**, which serves `https://nikita-aa7c.vercel.app`. Do not create or use a separate production project for the webhook.

The route is part of the same repository deployment as the website. It does not require a separate root directory or a separate custom domain. The main project's Vercel deployment protection is currently disabled, so the endpoint is reachable by Telegram without disabling website protection as a special-case change.

Required server-side environment variables in the main Vercel project's **Production** environment:

- `TELEGRAM_BOT_TOKEN`: token issued by BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: a separate random secret used by Telegram's webhook header.
- `TELEGRAM_BACKEND_SECRET`: must exactly match the Apps Script Script Property with the same name.
- `TELEGRAM_APPS_SCRIPT_URL`: the intended Apps Script Web App URL ending in `/exec`.

These Production variables have been prepared, but do not register or switch the live Telegram webhook until the main-project deployment containing this route is READY and the end-to-end test has passed. Do not copy test secrets into Production or change the Preview Apps Script URL: Preview must continue to use the test table.

## Apps Script Script Properties

In Apps Script: **Project Settings → Script Properties**. Add:

- `TELEGRAM_BACKEND_SECRET`: a random secret of at least 32 characters. It must match the main Vercel Production variable with the same name.

Do not use the Telegram bot token as this secret. Do not place the secret in source code.

## Register the Telegram webhook

Only after the main-project Production deployment containing `/api/telegram/webhook` is READY and end-to-end verification has passed, register the webhook with Telegram's `setWebhook` method:

- URL: `https://nikita-aa7c.vercel.app/api/telegram/webhook`
- `secret_token`: the exact value of `TELEGRAM_WEBHOOK_SECRET`
- `allowed_updates`: `["message"]`

Use a local terminal or a secure secret manager to call Telegram's Bot API. Never paste the bot token or secret token into GitHub issues, source files, screenshots, or ordinary chat messages.

## Apps Script version and data

The current source file `google-apps-script/Code.gs` declares API v11. Do not assume that editing the source file updates an existing Web App deployment: update the intended deployment to a new version while preserving its existing `/exec` URL.

The backend creates two Telegram sheets when needed:

- `telegram_links`
- `telegram_link_codes`

They contain Telegram IDs, app user IDs, family IDs, hashed one-time codes, and timestamps. Do not make the Google Sheet public.

## Test checklist

Use the test table and test Telegram account only. Do not create test transactions in the live family table.

- [ ] Requests without Telegram's webhook header are rejected by Vercel.
- [ ] Requests with a wrong backend secret are rejected by Apps Script.
- [ ] An expired or already-used link code is rejected.
- [ ] A Telegram account cannot take over a link belonging to another app user.
- [ ] An app user cannot link a second Telegram account without unlinking the first.
- [ ] A user who has left the family cannot keep using the bot.
- [ ] `/balance` returns only the linked family's current-month totals.
- [ ] `Проезд 45 рублей` creates exactly one 45 ₽ expense in the test family.
- [ ] A repeated Telegram update does not create a duplicate transaction.
- [ ] The second family member sees the transaction in the web app.
- [ ] `/unlink` immediately removes bot access.

## Current limitations

The first text parser is intentionally narrow. It recognizes a small set of common category aliases and otherwise assigns the "Неопределённая категория" category where available. It does not use an LLM and does not yet support editing/deleting transactions, account selection, transfers, receipts, or natural-language dates. Add these only after the deterministic flow is tested end to end.
