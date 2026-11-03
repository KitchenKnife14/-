# Telegram integration

## Architecture

Telegram is an additional interface to the existing family-budget backend. It must not write to Google Sheets directly and must not bypass the Apps Script authorization and family-isolation rules.

1. Telegram sends updates to the Vercel endpoint \`/api/telegram/webhook\`.
2. The Vercel function validates Telegram's \`X-Telegram-Bot-Api-Secret-Token\` header.
3. Vercel forwards the update to the existing Apps Script Web App using a separate server-to-server secret.
4. Apps Script maps the Telegram user ID to one linked application user and checks that the user is still a member of the linked family.
5. Apps Script writes transactions through the same validation path as the web application.
6. Vercel sends the returned text to Telegram using the bot token.

The Telegram bot token and both webhook secrets are server-side environment/script properties only. Never add them to \`VITE_*\` variables, frontend code, Git, or chat messages.

## Current implementation in this branch

- One-time linking code generation via Apps Script RPC \`create_telegram_link_code\`.
- Codes are stored as SHA-256 hashes, contain 12 characters, and expire after 15 minutes.
- A Telegram account can be linked to only one app account; an app account can have only one Telegram link.
- Apps Script webhook authentication via Script Property \`TELEGRAM_BACKEND_SECRET\`.
- Vercel webhook endpoint at \`/api/telegram/webhook\`.
- Commands: \`/start\`, \`/help\`, \`/link CODE\`, \`/unlink\`, \`/balance\`.
- Initial text transaction flow, e.g. \`Проезд 45 рублей\`.
- The handler uses the linked user's family membership and existing transaction validation.
- Telegram update IDs are cached in Apps Script properties to avoid duplicate writes when Telegram retries a webhook delivery.

## Configuration — do not enable until test backend is ready

### Apps Script Script Properties

In Apps Script: **Project Settings → Script Properties**. Add:

- \`TELEGRAM_BACKEND_SECRET\`: a newly generated random secret, at least 32 bytes. It must match the Vercel variable with the same name.

Do not use the Telegram bot token as this secret. Do not place the secret in source code.

### Vercel environment variables

In the existing Vercel project \`-\`, add these server-side variables. Configure Preview first; do not add Production values until the production Apps Script backend has been verified.

- \`TELEGRAM_BOT_TOKEN\`: token issued by BotFather.
- \`TELEGRAM_WEBHOOK_SECRET\`: a separate random string (Telegram accepts 1–256 characters; use a long random value).
- \`TELEGRAM_BACKEND_SECRET\`: the same value as the Apps Script Script Property.
- \`TELEGRAM_APPS_SCRIPT_URL\`: the test Apps Script Web App URL ending in \`/exec\`.

Do not prefix these variables with \`VITE_\`. Only \`VITE_*\` variables are exposed to the browser bundle.

### Register the Telegram webhook

After deploying the Vercel Preview function and configuring its environment variables, register the webhook using Telegram's \`setWebhook\` method. Use:

- URL: \`https://YOUR-PREVIEW-DOMAIN/api/telegram/webhook\`
- \`secret_token\`: the exact value of \`TELEGRAM_WEBHOOK_SECRET\`
- \`allowed_updates\`: \`["message"]\`

Do not put the bot token or secret token in GitHub issues, source files, screenshots, or ordinary chat messages. Use a local terminal or another secure secret manager to call Telegram's Bot API.

## Apps Script update

The current test deployment must be updated to include the new \`Code.gs\` before webhook testing. Update the existing deployment to a new version so its \`/exec\` URL remains unchanged.

The new backend adds two sheets automatically:

- \`telegram_links\`
- \`telegram_link_codes\`

The tables contain Telegram IDs, app user IDs, family IDs, hashed one-time codes, and timestamps. Do not make the Google Sheet public.

## Test checklist

Use the test table and test Telegram account only.

- [ ] Requests without Telegram's webhook header are rejected by Vercel.
- [ ] Requests with a wrong backend secret are rejected by Apps Script.
- [ ] An expired or already-used link code is rejected.
- [ ] A Telegram account cannot take over a link belonging to another app user.
- [ ] An app user cannot link a second Telegram account without unlinking the first.
- [ ] A user who has left the family cannot keep using the bot.
- [ ] \`/balance\` returns only the linked family's current-month totals.
- [ ] \`Проезд 45 рублей\` creates exactly one 45 ₽ expense in the linked family.
- [ ] A repeated Telegram update does not create a duplicate transaction.
- [ ] The second family member sees the transaction in the web app.
- [ ] \`/unlink\` immediately removes bot access.

## Current limitations

The first text parser is intentionally narrow. It recognizes a small set of common category aliases and otherwise assigns the "Неопределённая категория" category where available. It does not use an LLM and does not yet support editing/deleting transactions, account selection, transfers, receipts, or natural-language dates. These should be added only after the deterministic flow is tested end to end.
