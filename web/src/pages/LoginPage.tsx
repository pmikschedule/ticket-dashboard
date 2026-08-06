import { useState, type FormEvent } from 'react'

import { useAuth } from '../hooks/useAuth'
import { isConfigured } from '../lib/supabase'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-lg font-semibold text-slate-900">이슈 트래킹</h1>
            {/*
              로그인 전에도 보여야 합니다 — "화면이 안 바뀐다" 를 가장 먼저
              마주치는 곳이 이 화면이기 때문입니다. 배포했는데 이 값이 그대로면
              서버가 아니라 브라우저 캐시입니다 (강제 새로고침 ⌘⇧R / Ctrl+F5).
            */}
            <span
              className="font-mono text-[10px] text-slate-400"
              title={`빌드 ${__BUILD_ID__} · ${__BUILT_AT__}`}
            >
              {__BUILD_ID__}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">등록된 계정으로 로그인하세요.</p>
        </div>

        {!isConfigured && (
          <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
            Supabase 환경변수가 설정되지 않았습니다. 로컬은 <code>web/.env</code>, 배포는 GitHub
            Actions Secrets 를 확인하세요.
          </p>
        )}

        <div>
          <label className="label" htmlFor="email">
            이메일
          </label>
          <input
            id="email"
            type="email"
            className="field"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            비밀번호
          </label>
          <input
            id="password"
            type="password"
            className="field"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error && <p className="rounded-md bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={busy || !isConfigured}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </div>
  )
}
