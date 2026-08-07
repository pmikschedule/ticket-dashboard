/**
 * 후속 메일을 기존 티켓의 코멘트로 옮길 때 쓰는 순수 함수들.
 *
 * 코멘트 본문을 만드는 일과 티켓을 찾는 일 모두 화면 밖에서 정해집니다.
 * 렌더링 코드에서 문자열을 조립하면 테스트할 수가 없고, 이 본문은
 * **완료 회신 메일에 그대로 실려 요청자에게 나갑니다** (`reply.ts`).
 * 사람이 쓴 코멘트와 섞이는 자리라 형식이 흔들리면 안 됩니다.
 */

import type { ScannedMail, TicketWithMeta } from './types'

/** 코멘트 첫 줄에 붙는 표시. 사람이 쓴 코멘트와 구분하는 유일한 근거입니다. */
export const MAIL_COMMENT_PREFIX = '[메일]'

function formatStamp(iso: string | null): string {
  if (!iso) return '시각 미상'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '시각 미상'
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** 발신자를 '이름 <주소>' 로. 이름이 없으면 주소만. */
export function formatSender(mail: Pick<ScannedMail, 'sender_name' | 'sender_email'>): string {
  const name = (mail.sender_name || '').trim()
  const email = (mail.sender_email || '').trim() || '발신자 미상'
  return name ? `${name} <${email}>` : email
}

/**
 * 후속 메일 한 통을 코멘트 본문으로.
 *
 * 제목과 발신자·수신일시를 머리에 답니다. 본문만 넣으면 나중에 이 코멘트가
 * 언제 온 무엇인지 알 수 없게 됩니다 — 티켓 하나에 후속이 여러 번 붙으면
 * 특히 그렇습니다.
 */
export function buildMailComment(
  mail: Pick<
    ScannedMail,
    'subject' | 'body' | 'sender_name' | 'sender_email' | 'received_at' | 'scanned_at'
  >,
  note = '',
): string {
  const head = `${MAIL_COMMENT_PREFIX} ${formatStamp(mail.received_at ?? mail.scanned_at)} · ${formatSender(mail)}`
  const subject = (mail.subject || '').trim() || '(제목 없음)'
  const body = (mail.body || '').trim() || '(본문 없음)'
  const trimmedNote = note.trim()

  return [head, `제목: ${subject}`, '', body, ...(trimmedNote ? ['', `— ${trimmedNote}`] : [])].join(
    '\n',
  )
}

/** 이 코멘트가 메일에서 온 것인지. 화면에서 배지를 다는 데 씁니다. */
export function isMailComment(content: string): boolean {
  return content.trimStart().startsWith(MAIL_COMMENT_PREFIX)
}

/**
 * 검색어를 티켓 번호로 읽어 봅니다.
 *
 * '#42' · '42' 는 번호이고 'ERP' 는 아닙니다. 번호로 읽히면 그 티켓을 맨 위에
 * 올립니다 — 담당자는 번호를 알고 있을 때가 많고, 그때 목록을 훑게 하면
 * 빠르게 판단한다는 목적이 무너집니다.
 */
export function parseTicketNumber(term: string): number | null {
  const match = term.trim().match(/^#?(\d{1,9})$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * 후속으로 붙일 후보를 고르는 순서.
 *
 * 1. 같은 요청자의 티켓 — 후속 메일은 대개 본인이 다시 보냅니다
 * 2. 아직 안 끝난 것 — 끝난 건에 후속을 붙이는 일은 드뭅니다
 * 3. 최근 접수 순
 *
 * 정렬만 합니다. **거르지는 않습니다** — 대리 회신도 흔하고 완료된 건에
 * 뒤늦게 연락이 오기도 합니다. 안 보이면 사람이 못 고릅니다.
 */
export function rankLinkCandidates(
  tickets: TicketWithMeta[],
  senderEmail: string,
): TicketWithMeta[] {
  const sender = (senderEmail || '').trim().toLowerCase()

  return [...tickets].sort((a, b) => {
    const sameA = (a.reporter_email || '').toLowerCase() === sender ? 1 : 0
    const sameB = (b.reporter_email || '').toLowerCase() === sender ? 1 : 0
    if (sameA !== sameB) return sameB - sameA

    const openA = a.ticket_meta?.status !== 'done' ? 1 : 0
    const openB = b.ticket_meta?.status !== 'done' ? 1 : 0
    if (openA !== openB) return openB - openA

    const timeA = new Date(a.received_at ?? 0).getTime()
    const timeB = new Date(b.received_at ?? 0).getTime()
    return timeB - timeA
  })
}
