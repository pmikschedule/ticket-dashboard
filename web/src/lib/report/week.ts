/**
 * 주간 구간 — **화요일 00:00 ~ 그다음 월요일 24:00** (7일).
 *
 * 보고서는 월요일이 끝난 뒤에 씁니다. 그래서 한 주가 화요일에 시작해 월요일에
 * 끝나고, '이번 보고' 는 **방금 끝난 구간**(가장 최근 월요일로 끝나는 7일)입니다.
 * 오늘이 8/13(목)이면 8/4(화) ~ 8/10(월) 입니다.
 *
 * > 한때 ISO 주차(월~일, `2026-W33`)를 썼습니다. 팀의 보고 주기가 화~월이라
 * > 구간이 하루씩 어긋났습니다. desk 화면도 작성일 기준 최근 7일이라 ISO 와
 * > 맞지 않았습니다. 주차 번호 대신 **끝나는 월요일**을 id 로 씁니다 —
 * > 화~월 구간은 ISO 주차 두 개에 걸쳐 있어서 번호를 붙이면 거짓말이 됩니다.
 *
 * 날짜는 `YYYY-MM-DD` 문자열로 주고받고, 계산할 때만 UTC 밀리초로 내려갑니다.
 * 로컬 타임존으로 파싱하면 자정 경계가 하루씩 밀립니다.
 */

const DAY = 86_400_000

function toUtc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1)
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** 월요일=0 … 일요일=6. JS 의 일요일=0 을 그대로 쓰면 요일 계산이 하루 밀립니다 */
function mondayIndex(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7
}

export interface Week {
  /** 구간이 끝나는 월요일. 보고서 id·파일명에 씁니다 (`2026-08-10`) */
  id: string
  /** 시작 화요일 */
  from: string
  /** 끝 월요일 */
  to: string
  /** id 와 같습니다. 호출부가 '주차 이름' 으로 읽도록 별칭을 둡니다 */
  label: string
}

function build(mondayMs: number): Week {
  const id = toIso(mondayMs)
  return { id, label: id, from: toIso(mondayMs - 6 * DAY), to: id }
}

/**
 * 그 날짜가 속한 구간.
 *
 * 기준은 **그 날짜 이후(당일 포함) 첫 월요일**입니다. 화요일이면 6일 뒤 월요일까지,
 * 월요일이면 그날로 끝나는 구간입니다.
 */
export function weekOf(iso: string): Week {
  const ms = toUtc(iso)
  const untilMonday = (7 - mondayIndex(ms)) % 7
  return build(ms + untilMonday * DAY)
}

/**
 * 오늘 기준 **방금 끝난 구간** — 가장 최근 월요일(당일 포함)로 끝나는 7일.
 *
 * 월요일 당일에 뽑으면 그날로 끝나는 구간이 나옵니다. "금주 월요일까지" 라는
 * 말 그대로입니다.
 */
export function currentWeek(today: string): Week {
  const ms = toUtc(today)
  return build(ms - mondayIndex(ms) * DAY)
}

/** 끝나는 월요일로 구간을 만듭니다. 월요일이 아니면 null */
export function weekEnding(monday: string): Week | null {
  const ms = toUtc(monday)
  return mondayIndex(ms) === 0 ? build(ms) : null
}

/**
 * `2026-08-10` 을 되읽습니다. **월요일이 아니면 null** — CLI 가 여기서 막습니다.
 *
 * 월요일이 아닌 날짜를 받아 그 날이 속한 구간으로 바꿔 주지 않는 이유는,
 * 사용자가 의도한 주가 어느 쪽인지 알 수 없기 때문입니다. 되묻는 편이 낫습니다.
 */
export function parseWeekLabel(label: string): Week | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim())
  if (!m) return null
  return weekEnding(label.trim())
}

export function previousWeek(w: Week): Week {
  return build(toUtc(w.to) - 7 * DAY)
}

export function nextWeek(w: Week): Week {
  return build(toUtc(w.to) + 7 * DAY)
}

/** `2026-08-04` `2026-08-10` → `8/4(화) ~ 8/10(월)` */
export function rangeLabel(w: Week): string {
  const short = (iso: string, day: string) => {
    const [, m, d] = iso.split('-').map(Number)
    return `${m}/${d}(${day})`
  }
  return `${short(w.from, '화')} ~ ${short(w.to, '월')}`
}

/**
 * **어느 구간을 만들 수 있는가** — 오늘과 스냅샷 날짜를 나란히 놓습니다.
 *
 * 주간 보고서는 desk 스냅샷 하나로 만듭니다. 그런데 수집은 특정 PC 의 Chrome
 * 쿠키에 묶여 있어 **며칠씩 밀릴 수 있습니다.** 밀린 스냅샷으로 만들면 화면은
 * 아무 말 없이 지난 구간의 보고서를 내놓습니다 — 서식도 건수도 멀쩡해 보이는데
 * 내용이 2주 전입니다. 실제로 그랬습니다 (스냅샷 8/13, 오늘 8/21 → 8/4~8/10).
 *
 * 그래서 둘을 따로 계산해 화면이 **차이를 말하게** 합니다.
 *
 * - `target`    오늘 기준 만들어야 할 구간 (= 방금 끝난 화~월)
 * - `buildable` 이 스냅샷이 실제로 뒷받침하는 구간
 * - `fresh`     스냅샷이 `target` 마감일 이후에 떴는가
 *
 * `buildable` 로 계속 만드는 이유는, 오늘 날짜로 우겨 만들면 그 구간에 아무
 * 자료가 없어 **빈 보고서**가 나오기 때문입니다. 빈 보고서는 밀렸다는 사실보다
 * 알아채기 어렵습니다. 지난 구간을 만들되 지난 구간이라고 말합니다.
 */
/**
 * 오늘 날짜(`YYYY-MM-DD`) — **로컬 달력 기준**입니다.
 *
 * `toISOString()` 을 쓰면 UTC 라 한국 시간 오전 9시 이전에는 어제가 나옵니다.
 * 화~월 구간은 팀이 쓰는 달력의 요일이므로 로컬로 읽어야 맞습니다.
 */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export interface WeekTarget {
  target: Week
  buildable: Week
  fresh: boolean
  /** 몇 주 밀렸는가. 0 이면 최신입니다 */
  behindWeeks: number
}

export function weekForSnapshot(snapshotDay: string, today: string): WeekTarget {
  const target = currentWeek(today)
  const buildable = currentWeek(snapshotDay)
  const behind = Math.round((toUtc(target.to) - toUtc(buildable.to)) / (7 * DAY))
  return {
    target,
    buildable,
    // 마감일 당일 스냅샷도 그 구간을 덮습니다 — 월요일 저녁 스캔이 정상 운영입니다
    fresh: snapshotDay.slice(0, 10) >= target.to,
    behindWeeks: Math.max(0, behind),
  }
}

/** 그 날짜가 이 구간에 속하는지. 문자열 비교라 타임존에 안 흔들립니다 */
export function inWeek(iso: string | null | undefined, w: Week): boolean {
  if (!iso) return false
  const day = iso.slice(0, 10)
  return day >= w.from && day <= w.to
}
