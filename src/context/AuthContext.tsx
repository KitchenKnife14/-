import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { googleSheets, type GoogleGoogleSession } from '../lib/googleSheets'
import type { Profile, Family, FamilyMember } from '../lib/types'

interface AuthState {
  session: GoogleSession | null
  profile: Profile | null
  family: Family | null
  members: FamilyMember[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  family: null,
  members: [],
  loading: true,
  error: null,
  refresh: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setGoogleSession] = useState<GoogleSession | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [family, setFamily] = useState<Family | null>(null)
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (s: GoogleSession | null) => {
    if (!s) {
      setGoogleSession(null)
      setProfile(null)
      setFamily(null)
      setMembers([])
      setLoading(false)
      return
    }
    setGoogleSession(s)
    setLoading(true)
    setError(null)
    setProfile(null)
    setFamily(null)
    setMembers([])
    try {
      const { data, error } = await googleSheets.rpc('get_my_context', {})
      if (error) throw new Error(error.message)
      const c = data as { profile: Profile | null; members: FamilyMember[]; family: Family | null }
      setProfile(c.profile)
      setMembers(c.members ?? [])
      setFamily(c.family ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки профиля')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    googleSheets.auth.getGoogleSession().then(({ data }) => load(data.session ?? null))
    const { data: sub } = googleSheets.auth.onAuthStateChange((_event, s) => {
      (async () => load(s))()
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = async () => {
    const { data } = await googleSheets.auth.getGoogleSession()
    await load(data.session ?? null)
  }

  return (
    <AuthContext.Provider value={{ session, profile, family, members, loading, error, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
