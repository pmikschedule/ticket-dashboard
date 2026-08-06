import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * 설정 누락은 흰 화면 대신 콘솔 경고로 드러냅니다.
 * (GitHub Actions Secrets 를 등록하기 전 첫 배포에서 반드시 밟는 경로입니다.)
 */
export const isConfigured = Boolean(url && anonKey)

if (!isConfigured) {
  console.error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. ' +
      '로컬은 web/.env, 배포는 GitHub Actions Secrets 를 확인하세요.',
  )
}

/**
 * 브라우저는 **Publishable(anon) 키만** 씁니다. 공개돼도 RLS 가 막습니다.
 * service_role(Secret) 키는 에이전트 PC 의 .env 한 곳에만 존재해야 합니다.
 */
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const ATTACHMENT_BUCKET = 'ticket-attachments'
