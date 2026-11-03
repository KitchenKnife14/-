import { useCallback, useEffect, useState } from 'react'
import { Copy, Link2, Link2Off, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { googleSheets } from '../lib/googleSheets'

type TelegramStatus = { linked: boolean; linked_at?: string; telegram_chat_id?: string }
type LinkCode = { code: string; expires_at: string }

export default function TelegramPage() {
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [code, setCode] = useState<LinkCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await googleSheets.rpc('get_telegram_link_status')
    if (result.error) setError(result.error.message)
    else setStatus(result.data as TelegramStatus)
    setLoading(false)
  }, [])

  useEffect(() => { void loadStatus() }, [loadStatus])

  const createCode = async () => {
    setGenerating(true); setError(null); setNotice(null); setCode(null)
    const result = await googleSheets.rpc('create_telegram_link_code')
    if (result.error) setError(result.error.message)
    else {
      setCode(result.data as LinkCode)
      setNotice('Код создан. Он действует 15 минут и может быть использован один раз.')
    }
    setGenerating(false)
  }

  const copyCode = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText('/link ' + code.code)
      setNotice('Команда привязки скопирована.')
    } catch {
      setError('Не удалось скопировать. Выделите код и скопируйте его вручную.')
    }
  }

  const unlink = async () => {
    if (!window.confirm('Отвязать Telegram от этого аккаунта? Бот перестанет иметь доступ к семейному бюджету.')) return
    setUnlinking(true); setError(null); setNotice(null)
    const result = await googleSheets.rpc('unlink_telegram')
    if (result.error) setError(result.error.message)
    else { setCode(null); setNotice('Telegram отвязан.'); await loadStatus() }
    setUnlinking(false)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="page-title">Telegram</h1>
        <p className="page-subtitle">Добавляйте операции в семейный бюджет прямо из переписки с ботом.</p>
      </header>

      <section className="card space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-800"><MessageCircle size={21} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="section-title">Подключение аккаунта</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Привязка связывает ваш Telegram ID с текущим пользователем приложения. Доступ второго участника семьи не передаётся автоматически. Настройка webhook и серверных секретов ещё не завершена — бот пока не принимает реальные операции.</p>
          </div>
        </div>

        {loading ? <p className="text-sm text-muted">Проверяем статус подключения…</p> : status?.linked ? (
          <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary-900"><ShieldCheck size={17} /> Telegram привязан</div>
            {status.linked_at && <p className="mt-1 text-xs text-muted">Дата привязки: {new Date(status.linked_at).toLocaleString('ru-RU')}</p>}
            <button type="button" onClick={unlink} disabled={unlinking} className="btn-secondary mt-3 text-danger-600">
              <Link2Off size={16} /> {unlinking ? 'Отвязываем…' : 'Отвязать Telegram'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-canvas p-4">
              <div className="text-sm font-medium text-ink">1. Создайте одноразовый код</div>
              <p className="mt-1 text-xs leading-5 text-muted">Код действует 15 минут. Если срок истечёт, создайте новый.</p>
              <button type="button" onClick={createCode} disabled={generating || loading} className="btn-primary mt-3">
                <Link2 size={16} /> {generating ? 'Создаём код…' : 'Создать код привязки'}
              </button>
              {code && (
                <div className="mt-4 rounded-xl border border-primary-200 bg-surface p-3">
                  <div className="text-xs text-muted">Ваш код</div>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <code className="text-xl font-semibold tracking-[0.18em] text-ink">{code.code}</code>
                    <button type="button" onClick={copyCode} className="btn-secondary px-3 py-2"><Copy size={15} /> Копировать команду</button>
                  </div>
                  <p className="mt-2 text-xs text-muted">Отправьте боту: <code className="font-semibold">/link {code.code}</code></p>
                  <p className="mt-1 text-xs text-muted">Истекает: {new Date(code.expires_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.</p>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="text-sm font-medium text-ink">2. Отправьте код боту</div>
              <p className="mt-1 text-sm leading-6 text-muted">Откройте чат с ботом, нажмите «Start» и отправьте команду с кодом. После ответа бота обновите статус на этой странице.</p>
              <button type="button" onClick={loadStatus} disabled={loading} className="btn-secondary mt-3"><RefreshCw size={15} /> Проверить подключение</button>
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Что умеет бот</h2>
        <div className="space-y-2 text-sm text-muted">
          <p><code className="rounded bg-canvas px-1.5 py-0.5 text-ink">Проезд 45 рублей</code> — добавить расход.</p>
          <p><code className="rounded bg-canvas px-1.5 py-0.5 text-ink">Доход 5000 рублей зарплата</code> — добавить доход.</p>
          <p><code className="rounded bg-canvas px-1.5 py-0.5 text-ink">/balance</code> — сводка за текущий месяц.</p>
          <p><code className="rounded bg-canvas px-1.5 py-0.5 text-ink">/help</code> — список команд.</p>
        </div>
        <p className="border-t border-line pt-3 text-xs leading-5 text-muted">Бот пока находится в режиме подготовки. Пока webhook и секреты не настроены, подключение не завершится. Не отправляйте боту реальные финансовые данные до объявления о запуске тестирования.</p>
      </section>

      {error && <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">{notice}</div>}
    </div>
  )
}
