import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { fetchCurrentUser, signIn as apiSignIn, signOut as apiSignOut } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { AppUser } from '../lib/types'
import { isAdmin as checkAdmin } from '../lib/workflow'

interface AuthState {
  user: AppUser | null
  loading: boolean
  isAdmin: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  reload: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setUser(await fetchCurrentUser())
      setError(null)
    } catch (err) {
      // 로그인은 됐지만 public.users 행이 없는 경우 등. 화면에 드러냅니다.
      setError(err instanceof Error ? err.message : String(err))
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const { data } = supabase.auth.onAuthStateChange(() => {
      void load()
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      isAdmin: checkAdmin(user),
      // 여기서 setLoading(true) 을 하면 안 됩니다.
      // App 이 loading 중에 로딩 화면을 그리면서 LoginPage 가 언마운트되고,
      // 로그인이 실패해 되돌아올 때 새 컴포넌트로 다시 마운트됩니다.
      // 그러면 방금 담은 오류 메시지가 통째로 사라져서, 사용자 눈에는
      // "눌렀는데 아무 일도 안 일어나고 입력만 지워짐" 으로 보입니다.
      // 진행 중 표시는 LoginPage 가 자기 busy 상태로 처리합니다.
      signIn: async (email, password) => {
        await apiSignIn(email, password)
        await load()
      },
      signOut: async () => {
        await apiSignOut()
        setUser(null)
      },
      reload: load,
    }),
    [user, loading, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth 는 AuthProvider 안에서만 쓸 수 있습니다.')
  return context
}
