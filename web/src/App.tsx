import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout'
import { useAuth } from './hooks/useAuth'
import AdminPage from './pages/AdminPage'
import BoardPage from './pages/BoardPage'
import ListPage from './pages/ListPage'
import LoginPage from './pages/LoginPage'
import StatsPage from './pages/StatsPage'
import TicketDetailPage from './pages/TicketDetailPage'

export default function App() {
  const { user, loading, isAdmin, error } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500">불러오는 중…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <>
        {error && (
          <p className="bg-amber-50 p-3 text-center text-xs text-amber-800">
            로그인 정보를 확인하지 못했습니다: {error}
          </p>
        )}
        <LoginPage />
      </>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<BoardPage />} />
        <Route path="list" element={<ListPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="tickets/:id" element={<TicketDetailPage />} />
        {/* 화면 숨김은 편의일 뿐이고, 실제 차단은 RLS 가 합니다. */}
        <Route path="admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
