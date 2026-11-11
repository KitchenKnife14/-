import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'

export default function OnboardingPage() {
  const { session, profile, refresh } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [familyName, setFamilyName] = useState('Наша семья')
  const [inviteCode, setInviteCode] = useState('')
  const [userName, setUserName] = useState(profile?.display_name ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (!session?.user) throw new Error('Нет сессии')
      if (mode === 'create') {
        if (!familyName.trim()) throw new Error('Введите название семьи')
        const { error: createErr } = await googleSheets.rpc('create_family', {
          p_name: familyName.trim(),
          p_display_name: userName.trim(),
        })
        if (createErr) throw createErr
      } else {
        const code = inviteCode.trim().toUpperCase()
        if (!code) throw new Error('Введите код приглашения')
        const { error: joinErr } = await googleSheets.rpc('join_family_by_invite', {
          p_invite_code: code,
          p_display_name: userName.trim(),
        })
        if (joinErr) throw joinErr
      }
      // The family RPC confirms the write. Refresh loads the authoritative context;
      // App.tsx shows its retry screen if get_my_context fails, avoiding a duplicate create on retry.
      await refresh()
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-xl font-semibold text-primary-800">Б</div>
          <h1 className="page-title mb-1">Добро пожаловать</h1>
          <p className="text-sm text-slate-500">Создайте семейное пространство или присоединитесь к существующему.</p>
        </div>

        <div className="flex gap-1 mb-5 p-1 bg-slate-100 rounded-xl">
          <button onClick={() => setMode('create')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${mode === 'create' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            Создать семью
          </button>
          <button onClick={() => setMode('join')} className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'join' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            Присоединиться
          </button>
        </div>

        <form onSubmit={submit} className="card space-y-3">
          <div>
            <label className="label" htmlFor="onboarding-user-name">Ваше имя</label>
            <input id="onboarding-user-name" className="input" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Как вас зовут" />
          </div>
          {mode === 'create' ? (
            <div>
              <label className="label" htmlFor="onboarding-family-name">Название семьи</label>
              <input id="onboarding-family-name" className="input" value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="onboarding-invite-code">Код приглашения</label>
              <input id="onboarding-invite-code" className="input" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Введите код от партнёра" />
              <p className="text-xs text-slate-400 mt-1">Код выдаётся первым участником после создания семьи.</p>
            </div>
          )}
          {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Подождите…' : mode === 'create' ? 'Создать семью' : 'Присоединиться'}
          </button>
        </form>
      </div>
    </div>
  )
}

