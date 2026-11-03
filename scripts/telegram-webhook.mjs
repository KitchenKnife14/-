#!/usr/bin/env node

const [command, target] = process.argv.slice(2)
const token = process.env.TELEGRAM_BOT_TOKEN || ''
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || ''

function usage() {
  console.log('Usage:')
  console.log('  TELEGRAM_BOT_TOKEN=... node scripts/telegram-webhook.mjs info')
  console.log('  TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-webhook.mjs set https://YOUR-VERCEL-DOMAIN/api/telegram/webhook')
  console.log('  TELEGRAM_BOT_TOKEN=... node scripts/telegram-webhook.mjs delete')
}

async function callTelegram(method, payload) {
  const response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) {
    const description = typeof result.description === 'string' ? result.description : 'Telegram API request failed'
    throw new Error(description)
  }
  return result.result
}

async function main() {
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN in the environment first.')

  if (command === 'info') {
    const info = await callTelegram('getWebhookInfo')
    console.log(JSON.stringify({
      url: info.url,
      pending_update_count: info.pending_update_count,
      last_error_date: info.last_error_date || null,
      last_error_message: info.last_error_message || null,
      allowed_updates: info.allowed_updates || [],
    }, null, 2))
    return
  }

  if (command === 'set') {
    if (!target) throw new Error('Webhook URL is required.')
    if (secret.length < 32 || secret.length > 256 || !/^[A-Za-z0-9_-]+$/.test(secret)) {
      throw new Error('TELEGRAM_WEBHOOK_SECRET must be 32–256 characters using A-Z, a-z, 0-9, _ or -.')
    }
    const url = new URL(target)
    if (url.protocol !== 'https:' || !url.pathname.endsWith('/api/telegram/webhook')) {
      throw new Error('Webhook URL must be HTTPS and end with /api/telegram/webhook.')
    }
    const result = await callTelegram('setWebhook', {
      url: url.toString(),
      secret_token: secret,
      allowed_updates: ['message'],
    })
    console.log(result ? 'Webhook registered.' : 'Telegram did not confirm webhook registration.')
    return
  }

  if (command === 'delete') {
    const result = await callTelegram('deleteWebhook', { drop_pending_updates: false })
    console.log(result ? 'Webhook deleted; pending updates were preserved.' : 'Telegram did not confirm webhook deletion.')
    return
  }

  usage()
  throw new Error('Unknown command.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Telegram webhook utility failed.')
  process.exitCode = 1
})
