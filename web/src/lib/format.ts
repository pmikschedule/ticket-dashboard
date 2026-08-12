/** 표시 포맷 — 순수 함수. */

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * `datetime-local` 입력 칸의 값 ← ISO 문자열.
 *
 * 칸은 **로컬 시간**을 분 단위로 다루고 DB 는 UTC(timestamptz)를 담습니다.
 * ISO 를 그대로 value 에 넣으면 칸이 비어 보이고(`Z` 가 붙은 값은 못 읽습니다),
 * 칸 값을 그대로 저장하면 시차만큼 어긋난 접수일이 저장됩니다. 두 함수는
 * 짝입니다 — 한쪽만 쓰면 그 어긋남이 조용히 생깁니다.
 */
export function toDateTimeInput(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** 입력 칸의 로컬 시간 → ISO(UTC). 비었거나 읽을 수 없으면 null. */
export function fromDateTimeInput(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

/** 시간(hours)을 사람이 읽는 문장으로. 에이전트의 summarize.py 와 같은 규칙입니다. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours < 0) return '-'
  if (hours < 1) return `${Math.round(hours * 60)}분`
  if (hours < 24) return `${hours.toFixed(1)}시간`
  return `${(hours / 24).toFixed(1)}일`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 접수 후 경과일. 목록에서 방치된 티켓을 눈에 띄게 하려고 씁니다. */
export function daysSince(value: string | null | undefined, today: Date = new Date()): number | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const diff = today.getTime() - date.getTime()
  return Math.max(0, Math.floor(diff / 86_400_000))
}

export function relativeDays(value: string | null | undefined, today: Date = new Date()): string {
  const days = daysSince(value, today)
  if (days === null) return '-'
  if (days === 0) return '오늘'
  if (days === 1) return '어제'
  return `${days}일 전`
}

export function initials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 2)
}
