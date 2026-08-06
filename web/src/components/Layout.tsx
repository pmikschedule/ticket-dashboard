import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS } from '../lib/constants'

const NAV = [
  { to: '/', label: '보드', end: true },
  { to: '/list', label: '목록', end: false },
  { to: '/screening', label: '스크리닝', end: false },
  { to: '/weekly', label: '주간현황', end: false },
  { to: '/stats', label: '통계', end: false },
]

const ADMIN_NAV = [
  { to: '/settings', label: '설정' },
  { to: '/admin', label: '사용자' },
]

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth()

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <span className="text-sm font-semibold text-slate-900">이슈 트래킹</span>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            {isAdmin &&
              ADMIN_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm transition ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            {/* 구두·전화로 받은 요청은 어디서든 바로 넣을 수 있어야 합니다 */}
            <NavLink
              to="/new"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`
              }
            >
              + 요청 등록
            </NavLink>
            <span className="text-slate-600">
              {user?.name || user?.email}
              {user && (
                <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                  {ROLE_LABELS[user.role]}
                </span>
              )}
            </span>
            <button type="button" className="btn-secondary" onClick={() => void signOut()}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
