import { useId, useState } from 'react'
import { googleSheets } from '../lib/googleSheets'

export default function AuthPage() {
  const fieldId = useId()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error: err } = await googleSheets.auth.signUp({ email, password, options: { data: { display_name: name || email.split('@')[0] } } })
        if (err) throw err
      } else {
        const { error: err } = await googleSheets.auth.signInWithPassword({ email, password })
        if (err) throw err
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка авторизации')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-canvas">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100 text-2xl font-semibold text-primary-800 shadow-sm">Б</div>
          <h1 className="page-title">Бюджет для двоих</h1>
          <p className="text-sm text-slate-500 mt-1">Общее пространство для ваших финансов</p>
        </div>

        <div className="card">
          <div className="flex gap-1 mb-5 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              disabled={loading}
              onClick={() => setMode('signin')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${mode === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Вход
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setMode('signup')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <div>
                <label className="label" htmlFor={`${fieldId}-name`}>Имя</label>
                <input id={`${fieldId}-name`} className="input" autoComplete="name" disabled={loading} value={name} onChange={(e) => setName(e.target.value)} placeholder="Как вас зовут" />
              </div>
            )}
            <div>
              <label className="label" htmlFor={`${fieldId}-email`}>Email</label>
              <input id={`${fieldId}-email`} className="input" type="email" autoComplete={mode === 'signin' ? 'username' : 'email'} disabled={loading} required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="label" htmlFor={`${fieldId}-password`}>Пароль</label>
              <input id={`${fieldId}-password`} className="input" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} disabled={loading} required minLength={mode === 'signup' ? 15 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'Минимум 15 символов' : 'Введите пароль'} />
            </div>
            {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Подождите…' : mode === 'signin' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>
        </div>

        <p className="text-xs text-slate-400 text-center mt-4">
          Данные семьи доступны только двум участникам после входа.
        </p>
      </div>
    </div>
  )
}
