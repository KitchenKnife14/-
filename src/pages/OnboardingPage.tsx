import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/googleSheets'
import { ensureProfile, seedDefaultCategories } from '../lib/categories'

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
      if (userName.trim()) await ensureProfile(session.user.id, userName.trim())

      if (mode === 'create') {
        const { data: fam, error: fErr } = await supabase
          .from('families')
          .insert({ name: familyName.trim(), created_by: session.user.id })
          .select('*')
          .single()
        if (fErr) throw fErr
        const { error: mErr } = await supabase
          .from('family_members')
          .insert({ family_id: fam.id, user_id: session.user.id, role: 'owner' })
        if (mErr) throw mErr
        await seedDefaultCategories(fam.id)
      } else {
        const code = inviteCode.trim().toUpperCase()
        if (!code) throw new Error('Введите код приглашения')
        const { error: joinErr } = await supabase.rpc('join_family_by_invite', {
          p_invite_code: code,
        })
        if (joinErr) throw joinErr
      }
      await refresh()
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Добро пожаловать</h1>
        <p className="text-sm text-slate-500 mb-6">Создайте семейное пространство или присоединитесь к существующему.</p>

        <div className="flex gap-1 mb-4 p-1 bg-slate-100 rounded-lg">
          <button onClick={() => setMode('create')} className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'create' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            Создать семью
          </button>
          <button onClick={() => setMode('join')} className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'join' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            Присоединиться
          </button>
        </div>

        <form onSubmit={submit} className="card space-y-3">
          <div>
            <label className="label">Ваше имя</label>
            <input className="input" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Как вас зовут" />
          </div>
          {mode === 'create' ? (
            <div>
              <label className="label">Название семьи</label>
              <input className="input" value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="label">Код приглашения</label>
              <input className="input" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Введите код от партнёра" />
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

