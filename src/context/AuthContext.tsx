import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/googleSheets'
import type { Profile, Family, FamilyMember } from '../lib/types'

interface AuthState {
  session: Session | null
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
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [family, setFamily] = useState<Family | null>(null)
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (s: Session | null) => {
    if (!s) {
      setSession(null)
      setProfile(null)
      setFamily(null)
      setMembers([])
      setLoading(false)
      return
    }
    setSession(s)
    try {
      const { data: prof, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', s.user.id)
        .maybeSingle()
      if (pErr) throw pErr
      setProfile(prof as Profile | null)

      const { data: fm, error: fmErr } = await supabase
        .from('family_members')
        .select('*')
        .eq('user_id', s.user.id)
      if (fmErr) throw fmErr
      setMembers((fm as FamilyMember[]) ?? [])

      if (fm && fm.length > 0) {
        const famId = (fm[0] as FamilyMember).family_id
        const { data: fam, error: famErr } = await supabase
          .from('families')
          .select('*')
          .eq('id', famId)
          .maybeSingle()
        if (famErr) throw famErr
        setFamily(fam as Family | null)
      } else {
        setFamily(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки профиля')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      (async () => load(s))()
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = async () => {
    const { data } = await supabase.auth.getSession()
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
