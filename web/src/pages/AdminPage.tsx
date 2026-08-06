import { useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import { useUpdateUserRole, useUsers } from '../hooks/queries'
import { ROLE_LABELS } from '../lib/constants'
import { formatDate } from '../lib/format'

/** 사용자·권한 관리 (기획서 3.2). 관리자만 접근합니다. */
export default function AdminPage() {
  const { user } = useAuth()
  const { data: users = [], isLoading } = useUsers()
  const updateRole = useUpdateUserRole()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h1 className="text-base font-semibold text-slate-900">사용자 관리</h1>
        <p className="mt-1 text-sm text-slate-500">
          계정 생성은 Supabase 대시보드 → Authentication → Users 에서 합니다. 여기서는 역할만
          바꿉니다.
        </p>
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
              <th className="px-3 py-2 font-medium">이름</th>
              <th className="px-3 py-2 font-medium">메일</th>
              <th className="px-3 py-2 font-medium">역할</th>
              <th className="px-3 py-2 font-medium">가입일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  불러오는 중…
                </td>
              </tr>
            )}
            {users.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 text-slate-900">{entry.name || '(이름 없음)'}</td>
                <td className="px-3 py-2 text-slate-600">{entry.email}</td>
                <td className="px-3 py-2">
                  <select
                    className="field w-32"
                    value={entry.role}
                    // 마지막 관리자가 스스로를 강등하면 아무도 배정·발송을 할 수 없게 됩니다.
                    disabled={entry.id === user?.id}
                    onChange={(event) => {
                      setError(null)
                      updateRole.mutate(
                        { userId: entry.id, role: event.target.value as 'admin' | 'member' },
                        {
                          onError: (err) =>
                            setError(err instanceof Error ? err.message : String(err)),
                        },
                      )
                    }}
                  >
                    <option value="member">{ROLE_LABELS.member}</option>
                    <option value="admin">{ROLE_LABELS.admin}</option>
                  </select>
                  {entry.id === user?.id && (
                    <p className="mt-0.5 text-[11px] text-slate-400">본인 역할은 바꿀 수 없습니다</p>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{formatDate(entry.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
