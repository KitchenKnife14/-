import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { googleSheets, type GoogleSession } from '../lib/googleSheets'
import type { Profile, Family, FamilyMember } from '../lib/types'

interface AuthState {
  session: GoogleSession | null
  profile: Profile | null
  family: Family | null
  members: FamilyMember[]
  memberProfiles: Profile[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  family: null,
  members: [],
  memberProfiles: [],
  loading: true,
  error: null,
  refresh: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GoogleSession | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [family, setFamily] = useState<Family | null>(null)
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [memberProfiles, setMemberProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSequence = useRef(0)

  const load = async (s: GoogleSession | null, sequence = ++loadSequence.current) => {
    if (sequence !== loadSequence.current) return
    if (!s) {
      setSession(null)
      setProfile(null)
      setFamily(null)
      setMembers([])
      setMemberProfiles([])
      setLoading(false)
      setError(null)
      return
    }
    setSession(s)
    setLoading(true)
    setError(null)
    setProfile(null)
    setFamily(null)
    setMembers([])
    setMemberProfiles([])
    try {
      const { data, error } = await googleSheets.rpc('get_my_context', {})
      if (error) throw new Error(error.message)
      const c = data as { profile: Profile | null; members: FamilyMember[]; family: Family | null; member_profiles?: Profile[] }
      if (sequence !== loadSequence.current) return
      setProfile(c.profile)
      setMembers(c.members ?? [])
      setMemberProfiles(c.member_profiles ?? (c.profile ? [c.profile] : []))
      setFamily(c.family ?? null)
    } catch (e) {
      if (sequence !== loadSequence.current) return
      setMemberProfiles([])
      setError(e instanceof Error ? e.message : 'Ошибка загрузки профиля')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }

  useEffect(() => {
    const initialSequence = ++loadSequence.current
    const { data: sub } = googleSheets.auth.onAuthStateChange((_event, session) => {
      void load(session)
    })
    googleSheets.auth.getSession()
      .then(({ data }) => {
        if (initialSequence === loadSequence.current) void load(data.session ?? null, initialSequence)
      })
      .catch((e: unknown) => {
        if (initialSequence !== loadSequence.current) return
        setError(e instanceof Error ? e.message : 'Не удалось получить сессию')
        setLoading(false)
      })
    return () => {
      loadSequence.current++
      sub.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError(null)
    try {
      const { data } = await googleSheets.auth.getSession()
      if (sequence !== loadSequence.current) return
      await load(data.session ?? null, sequence)
    } catch (e) {
      if (sequence !== loadSequence.current) return
      setError(e instanceof Error ? e.message : 'Не удалось обновить сессию')
      setLoading(false)
    }
  }

  return (
    <AuthContext.Provider value={{ session, profile, family, members, memberProfiles, loading, error, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
