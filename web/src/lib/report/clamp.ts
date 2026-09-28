/**
 * 칸에 들어가는 만큼만 — 글이 칸을 넘지 않게 줄입니다.
 *
 * pptx 는 글자 폭을 알려 주지 않고, 넘치면 **아래 행 위로 겹쳐 그립니다.**
 * 진행사항 칸(0.9인치, 여덟 글자)에 desk 메모를 그대로 넣었더니 한 행에 네다섯
 * 줄이 쌓여 위아래 행 글자와 포개졌습니다. 그래서 여기서 미리 재고 자릅니다.
 *
 * **넉넉하게 잽니다.** 모자라게 재면 겹침이 그대로 남고 파워포인트는 알려 주지
 * 않습니다. 한 글자 더 자르는 편이 낫습니다.
 */

/**
 * 한 글자의 폭(em).
 *
 * 한글과 `→ — · …` 같은 기호는 Calibri 에 없어 대체 글꼴(맑은 고딕 등)로 그려지고
 * 거의 1em 입니다. `milestones.textWidth` 는 기호를 라틴 폭으로 쳐서 여기 쓰기엔
 * 모자랍니다 — 진행 메모에는 `→` 와 `—` 가 흔합니다.
 */
function em(ch: string): number {
  if (ch === ' ') return 0.3
  if (ch.charCodeAt(0) > 0x7f) return 1
  if (/[A-Z0-9mw@%#&]/.test(ch)) return 0.62
  return 0.52
}

/** 글자 폭(인치) */
export function widthIn(s: string, sz: number): number {
  let n = 0
  for (const ch of s) n += em(ch)
  return (n * sz) / 72
}

/**
 * 줄 나눔 어림.
 *
 * **어절 단위로 접고**, 한 줄보다 긴 어절만 글자 단위로 끊습니다. 파워포인트는
 * 한글을 어절로 접습니다 — 글자 단위로 접힌다고 가정하면 실제로는 한 줄이 더
 * 생깁니다. 반대로 뷰어가 글자 단위로 접으면 여기 셈보다 줄이 적을 뿐입니다.
 */
export function wrapLines(s: string, w: number, sz: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of s.split(' ')) {
    if (!word) continue
    const joined = line ? `${line} ${word}` : word
    if (widthIn(joined, sz) <= w) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    line = ''
    if (widthIn(word, sz) <= w) {
      line = word
      continue
    }
    for (const ch of word) {
      if (line && widthIn(line + ch, sz) > w) {
        lines.push(line)
        line = ''
      }
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

export function fits(s: string, w: number, sz: number, maxLines: number): boolean {
  return wrapLines(s, w, sz).length <= maxLines
}

/** 자른 자리 끝에 남으면 어색한 이음표·구분자 */
const TRAIL = /[\s+·,/—–→\-:;|&]+$/

/**
 * `maxLines` 안에 들어가게 뒤를 자르고 `…` 을 답니다.
 *
 * 되도록 **어절 경계에서** 자릅니다 — `마이그레…` 보다 `마이그레이션 …` 쪽이
 * 읽힙니다. 다만 경계까지 물러나면 너무 많이 잃을 때는(글자 단위로 자른 것의
 * 60% 미만) 글자 단위로 자릅니다.
 */
export function clampText(s: string, w: number, sz: number, maxLines: number): string {
  const text = s.trim()
  if (fits(text, w, sz, maxLines)) return text
  const chars = [...text]

  let best = 0
  for (let n = chars.length - 1; n > 0; n -= 1) {
    const head = chars.slice(0, n).join('').replace(TRAIL, '')
    if (head && fits(`${head}…`, w, sz, maxLines)) {
      best = n
      break
    }
  }
  if (best === 0) return '…'

  const space = chars.slice(0, best + 1).lastIndexOf(' ')
  const cut = space >= best * 0.6 ? space : best
  return `${chars.slice(0, cut).join('').replace(TRAIL, '')}…`
}

/**
 * 진행사항 칸의 글 — **짧게, 칸을 넘지 않게.**
 *
 * 순서대로 해 보고 들어가는 첫 모양을 씁니다.
 *
 * 1. 안건 이름을 되풀이하는 머리를 뗍니다 (`앱 총괄 — 권한관리…` → `권한관리…`).
 *    바로 왼쪽 칸이 안건이라 같은 말을 두 번 싣는 셈입니다
 * 2. 그대로 들어가면 그대로
 * 3. 괄호 속 부연(`(Sloan 안내 예정)`)을 뺍니다
 * 4. 첫 마디만 남깁니다 (`—`·`→`·쉼표 앞) — 뒤가 있다는 뜻으로 `…`
 * 5. 그래도 길면 칸 끝에서 자릅니다
 *
 * 글을 새로 짓지는 않습니다. 원문의 앞부분을 남길 뿐입니다.
 */
export function briefText(text: string, title: string, w: number, sz: number, maxLines = 2): string {
  let t = text.replace(/\s+/g, ' ').trim()
  const head = title.trim()
  if (head && t.startsWith(head) && t.length > head.length) {
    t = t.slice(head.length).replace(/^[\s—–\-:·|,]+/, '')
  }
  t = t.replace(/[.。]$/, '')
  if (!t || fits(t, w, sz, maxLines)) return t

  const bare = t.replace(/\s*[(（][^()（）]*[)）]/g, '').trim()
  if (bare && fits(bare, w, sz, maxLines)) return bare

  const src = bare || t
  const clause = src.split(/\s+[—–→]\s+|[,;]\s+|\.\s+/)[0]?.replace(TRAIL, '').trim() ?? ''
  if (clause && clause !== src && fits(`${clause}…`, w, sz, maxLines)) return `${clause}…`

  return clampText(src, w, sz, maxLines)
}

/**
 * 여러 이름을 한 줄에 — `재가입 구현, 카카오로 가입하기 구현 외 2건`.
 *
 * 묶음 행의 안건 칸이 씁니다. 앞에서부터 들어가는 만큼 싣고 나머지는 건수로
 * 적습니다. 첫 이름조차 안 들어가면 그 이름을 잘라서라도 한 건은 보입니다.
 */
export function listLine(names: string[], w: number, sz: number): string {
  const all = names.join(', ')
  if (fits(all, w, sz, 1)) return all

  for (let k = names.length - 1; k >= 1; k -= 1) {
    const s = `${names.slice(0, k).join(', ')} 외 ${names.length - k}건`
    if (fits(s, w, sz, 1)) return s
  }
  const tail = ` 외 ${names.length - 1}건`
  const room = Math.max(0, w - widthIn(tail, sz))
  return `${clampText(names[0] ?? '', room, sz, 1)}${tail}`
}
