import { useState } from 'react'
import { googleSheets } from '../lib/googleSheets'

export default function AuthPage() {
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
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">Бюджет для двоих</h1>
          <p className="text-sm text-slate-500 mt-1">Семейный финансовый менеджер</p>
        </div>

        <div className="card">
          <div className="flex gap-1 mb-4 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setMode('signin')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Вход
            </button>
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <div>
                <label className="label">Имя</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Как вас зовут" />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="label">Пароль</label>
              <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Минимум 8 символов" />
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
