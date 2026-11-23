import { Link, NavLink, Outlet } from 'react-router-dom'

import { usePendingScanCount, useSettings } from '../hooks/queries'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS } from '../lib/constants'
import { deskAuthNotice, readDeskStatus } from '../lib/deskAuth'

const NAV = [
  { to: '/', label: '보드', end: true },
  { to: '/list', label: '목록', end: false },
  { to: '/screening', label: '스크리닝', end: false },
  { to: '/weekly', label: '주간현황', end: false },
  { to: '/taskmap', label: '태스크맵', end: false },
  { to: '/gantt', label: '일정', end: false },
  { to: '/stats', label: '통계', end: false },
]

const ADMIN_NAV = [
  { to: '/settings', label: '설정' },
  { to: '/admin', label: '사용자' },
]

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth()
  // 분류에 실패한 메일은 티켓이 아니라 스크리닝에 쌓입니다. 보드에는 안 뜨므로
  // 여기 숫자가 없으면 아무도 모르는 채로 묻힙니다.
  const { data: pendingScans = 0 } = usePendingScanCount()

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <span className="text-sm font-semibold text-slate-900">이슈 트래킹</span>

          {/*
            빌드 표시. GitHub Pages 는 index.html 에 max-age=600 을 걸기 때문에
            브라우저가 옛 HTML 을 물고 있으면 배포해도 화면이 그대로입니다.
            그때 이 값이 안 바뀌면 서버가 아니라 캐시가 문제라는 걸 바로 압니다.
            (강제 새로고침: 맥 ⌘⇧R / 윈도우 Ctrl+F5)
          */}
          <span
            className="hidden font-mono text-[10px] text-slate-400 sm:inline"
            title={`빌드 ${__BUILD_ID__} · ${__BUILT_AT__}\n화면이 안 바뀌면 강제 새로고침 (⌘⇧R / Ctrl+F5)`}
          >
            {__BUILD_ID__}
          </span>

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
                {item.to === '/screening' && pendingScans > 0 && (
                  <span
                    title={`자동 분류가 실패해 접수 여부를 정해야 하는 메일 ${pendingScans}건`}
                    className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800"
                  >
                    {pendingScans}
                  </span>
                )}
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
        <DeskAuthBanner isAdmin={isAdmin} />
        <Outlet />
      </main>
    </div>
  )
}

/**
 * desk 쿠키 만료 배너 — 만료 7일 전부터, 만료됐거나 인증이 없으면 계속.
 *
 * 만료를 놓쳐 desk 수집이 11~12일씩 빈 적이 두 번 있습니다. 그동안 주간보고서는
 * 묵은 스냅샷으로 멀쩡해 보였습니다. 쿠키는 관리자만 바꿀 수 있지만, 보고서는 누구나
 * 만들므로 **모두에게** 띄웁니다. 판단은 `deskAuth.deskAuthNotice` 순수 함수입니다.
 */
function DeskAuthBanner({ isAdmin }: { isAdmin: boolean }) {
  const { data: settings = [] } = useSettings()
  const notice = deskAuthNotice(readDeskStatus(settings), Date.now())
  if (!notice) return null
  const tone =
    notice.level === 'error'
      ? 'bg-rose-50 text-rose-800 ring-rose-200'
      : 'bg-amber-50 text-amber-800 ring-amber-200'
  return (
    <div className={`mb-4 rounded-lg px-3 py-2 text-xs leading-relaxed ring-1 ${tone}`} role="status">
      {notice.text}{' '}
      {isAdmin ? (
        <Link to="/settings" className="font-medium underline">
          설정 → desk 인증에서 새 쿠키 넣기
        </Link>
      ) : (
        '관리자에게 알려 주세요.'
      )}
    </div>
  )
}
