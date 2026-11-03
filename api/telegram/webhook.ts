type ApiRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (value: unknown) => void
  setHeader: (name: string, value: string) => void
}

type TelegramUpdate = {
  update_id?: number
  message?: { chat?: { id?: number; type?: string } }
}

type BackendReply = { chat_id?: string | number; text?: string; skip?: boolean }
type BackendResponse = { data?: BackendReply; error?: { message?: string } | null }
type RuntimeEnvironment = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}

function secretMatches(received: string, expected: string): boolean {
  if (received.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index++) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const env = (globalThis as RuntimeEnvironment).process?.env ?? {}
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET || ''
  const backendSecret = env.TELEGRAM_BACKEND_SECRET || ''
  const botToken = env.TELEGRAM_BOT_TOKEN || ''
  const appsScriptUrl = env.TELEGRAM_APPS_SCRIPT_URL || ''

  if (!webhookSecret || !backendSecret || !botToken || !appsScriptUrl ||
      webhookSecret.length < 32 || backendSecret.length < 32) {
    return res.status(503).json({ ok: false, error: 'Telegram integration is not configured' })
  }

  const header = req.headers['x-telegram-bot-api-secret-token']
  const receivedSecret = Array.isArray(header) ? header[0] : header || ''
  if (!secretMatches(receivedSecret, webhookSecret)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  try {
    const backendUrl = new URL(appsScriptUrl)
    if (
      backendUrl.protocol !== 'https:' ||
      backendUrl.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[^/]+\/exec$/.test(backendUrl.pathname)
    ) {
      return res.status(503).json({ ok: false, error: 'Telegram backend URL is invalid' })
    }
  } catch {
    return res.status(503).json({ ok: false, error: 'Telegram backend URL is invalid' })
  }

  let update: TelegramUpdate
  try {
    update = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as TelegramUpdate
    if (!update || typeof update !== 'object') throw new Error('Invalid update')
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' })
  }

  try {
    const backendResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'telegramWebhook',
        telegramSecret: backendSecret,
        update,
      }),
    })

    if (!backendResponse.ok) throw new Error('Apps Script request failed')
    const raw = await backendResponse.text()
    let result: BackendResponse
    try {
      result = JSON.parse(raw) as BackendResponse
    } catch {
      throw new Error('Apps Script returned a non-JSON response')
    }

    const chatId = update.message?.chat?.id
    const reply = result.error
      ? { chat_id: chatId, text: result.error.message || 'Не удалось обработать сообщение.' }
      : result.data

    if (reply?.chat_id && reply.text && !reply.skip) {
      const telegramResponse = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: reply.chat_id,
          text: reply.text,
          disable_web_page_preview: true,
        }),
      })
      const telegramResult = await telegramResponse.json() as { ok?: boolean }
      if (!telegramResponse.ok || !telegramResult.ok) {
        throw new Error('Telegram sendMessage failed')
      }
    }

    return res.status(200).json({ ok: true })
  } catch {
    // Do not log secrets, message contents, or financial data.
    return res.status(502).json({ ok: false, error: 'Webhook processing failed; Telegram may retry safely' })
  }
}
