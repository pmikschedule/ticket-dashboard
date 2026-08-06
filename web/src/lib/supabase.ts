import { createClient } from '@supabase/supabase-js'

// `?? ` 가 아니라 `||` 와 trim 을 씁니다.
// GitHub Actions 에서 Secrets 가 등록되지 않으면 값이 undefined 가 아니라
// **빈 문자열**로 주입됩니다. `??` 는 빈 문자열을 통과시키므로
// createClient('') 가 모듈 로드 시점에 예외를 던지고 화면 전체가 흰 화면이 됩니다.
const url = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

/**
 * 설정 누락은 **흰 화면이 아니라 로그인 화면의 안내 배너**로 드러납니다.
 * (GitHub Actions Secrets 를 등록하기 전 첫 배포에서 반드시 밟는 경로입니다.)
 */
export const isConfigured = Boolean(url && anonKey)

if (!isConfigured) {
  console.error(
    '[설정 누락] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 비어 있습니다. ' +
      '로컬은 web/.env, 배포는 GitHub Actions Secrets 를 확인하세요. ' +
      'Secrets 는 빌드 시점에 주입되므로 등록 후 재배포해야 반영됩니다.',
  )
}

/**
 * 브라우저는 **Publishable(anon) 키만** 씁니다. 공개돼도 RLS 가 막습니다.
 * service_role(Secret) 키는 에이전트 PC 의 .env 한 곳에만 존재해야 합니다.
 *
 * 설정이 없을 때도 createClient 가 던지지 않도록 형식만 유효한 자리표시자를 넘깁니다.
 * 앱은 뜨고, 사용자는 로그인 화면에서 무엇이 빠졌는지 읽을 수 있습니다.
 */
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
)

export const ATTACHMENT_BUCKET = 'ticket-attachments'
