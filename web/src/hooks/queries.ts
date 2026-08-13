import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import * as api from '../lib/api'
import type { Resolution, ScanOutcome } from '../lib/constants'
import type { ScannedMail, TicketFilters, TicketMeta } from '../lib/types'

export const keys = {
  tickets: (filters: TicketFilters) => ['tickets', filters] as const,
  ticket: (id: number) => ['ticket', id] as const,
  comments: (id: number) => ['comments', id] as const,
  attachments: (id: number) => ['attachments', id] as const,
  history: (id: number) => ['history', id] as const,
  outbound: (id: number) => ['outbound', id] as const,
  users: ['users'] as const,
  leadTimes: ['lead-times'] as const,
  systems: ['systems'] as const,
  allSystems: ['systems', 'all'] as const,
  intakeRules: ['intake-rules'] as const,
  settings: ['settings'] as const,
  secrets: ['secrets'] as const,
  scans: (filters: api.ScanFilters) => ['scans', filters] as const,
  manualIntakes: ['manual-intakes'] as const,
  snapshot: ['desk-snapshot'] as const,
  snapshotDays: ['desk-snapshot-days'] as const,
  taskMap: ['task-map'] as const,
}

export function useTickets(filters: TicketFilters) {
  return useQuery({ queryKey: keys.tickets(filters), queryFn: () => api.fetchTickets(filters) })
}

export function useTicket(id: number) {
  return useQuery({ queryKey: keys.ticket(id), queryFn: () => api.fetchTicket(id), enabled: id > 0 })
}

export function useComments(id: number) {
  return useQuery({ queryKey: keys.comments(id), queryFn: () => api.fetchComments(id), enabled: id > 0 })
}

/** 티켓의 근거가 된 원본 메일 (증적). 수동 등록 티켓이면 null 입니다. */
export function useOriginalMail(id: number) {
  return useQuery({
    queryKey: ['original-mail', id],
    queryFn: () => api.fetchOriginalMail(id),
    enabled: id > 0,
  })
}

export function useAttachments(id: number) {
  return useQuery({
    queryKey: keys.attachments(id),
    queryFn: () => api.fetchAttachments(id),
    enabled: id > 0,
  })
}

export function useStatusHistory(id: number) {
  return useQuery({
    queryKey: keys.history(id),
    queryFn: () => api.fetchStatusHistory(id),
    enabled: id > 0,
  })
}

export function useOutboundEmails(id: number) {
  return useQuery({
    queryKey: keys.outbound(id),
    queryFn: () => api.fetchOutboundEmails(id),
    enabled: id > 0,
  })
}

export function useUsers() {
  return useQuery({ queryKey: keys.users, queryFn: api.fetchUsers })
}

export function useLeadTimes() {
  return useQuery({ queryKey: keys.leadTimes, queryFn: api.fetchLeadTimes })
}

/** 상태나 메타가 바뀌면 목록·상세·통계가 전부 흔들립니다. 한 번에 무효화합니다. */
function invalidateTicket(queryClient: ReturnType<typeof useQueryClient>, ticketId: number) {
  void queryClient.invalidateQueries({ queryKey: ['tickets'] })
  void queryClient.invalidateQueries({ queryKey: keys.ticket(ticketId) })
  void queryClient.invalidateQueries({ queryKey: keys.history(ticketId) })
  void queryClient.invalidateQueries({ queryKey: keys.leadTimes })
}

// ── 시스템 등록표 ────────────────────────────────────────────────────────────

export function useSystems() {
  return useQuery({ queryKey: keys.systems, queryFn: api.fetchSystems, staleTime: 300_000 })
}

export function useAllSystems() {
  return useQuery({ queryKey: keys.allSystems, queryFn: api.fetchAllSystems })
}

/**
 * 코드 → 표시명 매핑.
 *
 * 등록표에 없는 코드는 undefined 를 돌려주고, 화면은 '미분류' 로 표시합니다.
 * 시스템을 지운 뒤에도 과거 티켓이 사라지지 않게 하려는 의도된 동작입니다.
 */
export function useSystemLabels(): (code: string | null | undefined) => string | undefined {
  const { data: systems = [] } = useSystems()
  const map = new Map(systems.map((s) => [s.code, s.name]))
  return (code) => (code ? map.get(code) : undefined)
}

function invalidateSystems(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['systems'] })
}

export function useCreateSystem() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: api.createSystem, onSuccess: () => invalidateSystems(queryClient) })
}

export function useUpdateSystem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof api.updateSystem>[1] }) =>
      api.updateSystem(id, patch),
    onSuccess: () => invalidateSystems(queryClient),
  })
}

export function useDeleteSystem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteSystem(id),
    onSuccess: () => invalidateSystems(queryClient),
  })
}

// ── 접수 판정 기준 ───────────────────────────────────────────────────────────

export function useIntakeRules() {
  return useQuery({ queryKey: keys.intakeRules, queryFn: api.fetchIntakeRules })
}

function invalidateRules(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: keys.intakeRules })
}

export function useCreateIntakeRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createIntakeRule,
    onSuccess: () => invalidateRules(queryClient),
  })
}

export function useUpdateIntakeRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof api.updateIntakeRule>[1] }) =>
      api.updateIntakeRule(id, patch),
    onSuccess: () => invalidateRules(queryClient),
  })
}

export function useDeleteIntakeRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteIntakeRule(id),
    onSuccess: () => invalidateRules(queryClient),
  })
}

// ── 설정 ─────────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: api.fetchSettings })
}

export function useUpdateSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.updateSetting(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.settings }),
  })
}

/**
 * 비밀값의 **등록 상태**만 읽습니다. 값은 서버가 돌려주지 않습니다.
 *
 * 관리자가 아니면 함수가 예외를 던지므로, 화면에서는 관리자일 때만 부릅니다.
 */
export function useSecretStatus(enabled = true) {
  return useQuery({
    queryKey: keys.secrets,
    queryFn: api.fetchSecretStatus,
    enabled,
    // 비밀값 상태를 오래 들고 있을 이유가 없습니다.
    staleTime: 0,
    retry: false,
  })
}

export function useSetSecret() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.setSecret(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.secrets }),
  })
}

export function useClearSecret() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api.clearSecret(key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.secrets }),
  })
}

// ── 메일 스크리닝 ────────────────────────────────────────────────────────────

export function useScannedMails(filters: api.ScanFilters) {
  return useQuery({ queryKey: keys.scans(filters), queryFn: () => api.fetchScannedMails(filters) })
}

/** 후속 메일을 붙일 티켓 후보. 검색어가 비어도 최근 것을 보여 줍니다. */
export function useLinkCandidates(term: string) {
  return useQuery({
    queryKey: ['link-candidates', term],
    queryFn: () => api.searchTicketsForLink(term),
  })
}

/** 후속 메일을 기존 티켓에 코멘트로 붙입니다. */
export function useLinkScanToTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      scan,
      ticketId,
      userId,
      note,
    }: {
      scan: ScannedMail
      ticketId: number
      userId: string
      note?: string
    }) => api.linkScanToTicket(scan, ticketId, userId, note),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['scans'] })
      void queryClient.invalidateQueries({ queryKey: keys.comments(variables.ticketId) })
    },
  })
}

/** 처리 결과별 건수 — 스크리닝이 비어 보일 때 어디로 갔는지 알려 줍니다. */
export function useScanOutcomeCounts() {
  return useQuery({ queryKey: ['scans', 'outcome-counts'], queryFn: api.countScansByOutcome })
}

/** 상단 메뉴의 '판단 대기' 배지. 1분마다 다시 셉니다. */
export function usePendingScanCount() {
  return useQuery({
    queryKey: ['scans', 'pending-count'],
    queryFn: api.countPendingScans,
    refetchInterval: 60_000,
  })
}

export function useMarkReviewed() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      userId,
      note,
      outcome,
    }: {
      id: number
      userId: string
      note?: string
      outcome?: ScanOutcome
    }) => api.markScanReviewed(id, userId, note, outcome),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scans'] }),
  })
}

export function useConvertScanToTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      scan,
      userId,
      overrides,
    }: {
      scan: Parameters<typeof api.convertScanToTicket>[0]
      userId: string
      overrides?: Parameters<typeof api.convertScanToTicket>[2]
    }) => api.convertScanToTicket(scan, userId, overrides),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scans'] })
      void queryClient.invalidateQueries({ queryKey: ['tickets'] })
      void queryClient.invalidateQueries({ queryKey: keys.leadTimes })
    },
  })
}

// ── 수동 등록 ────────────────────────────────────────────────────────────────

export function useManualIntakes() {
  return useQuery({
    queryKey: keys.manualIntakes,
    queryFn: () => api.fetchManualIntakes(),
    // 에이전트가 처리하는 데 시간이 걸리므로 주기적으로 다시 봅니다.
    refetchInterval: 10_000,
  })
}

export function useQueueManualIntake() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.queueManualIntake,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.manualIntakes })
      void queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useUpdateStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      ticketId,
      status,
      resolution,
      hold_reason,
    }: {
      ticketId: number
      status: string
      resolution?: Resolution | null
      hold_reason?: string | null
    }) => api.updateTicketStatus(ticketId, status, { resolution, hold_reason }),
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.ticketId),
  })
}

export function useUpdateMeta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      ticketId,
      patch,
    }: {
      ticketId: number
      patch: Partial<
        Pick<
          TicketMeta,
          | 'work_type'
          | 'category'
          | 'severity'
          | 'system_type'
          | 'assignee_id'
          | 'estimated_days'
        >
      >
    }) => api.updateTicketMeta(ticketId, patch),
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.ticketId),
  })
}

export function useUpdateTicketFields() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      ticketId,
      patch,
    }: {
      ticketId: number
      // api.updateTicketFields 의 인자 그대로. 두 곳에 같은 목록을 적어 두면
      // 필드를 늘릴 때마다 한쪽만 고치게 됩니다.
      patch: Parameters<typeof api.updateTicketFields>[1]
    }) => api.updateTicketFields(ticketId, patch),
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.ticketId),
  })
}

export function useAddComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      ticketId,
      userId,
      content,
    }: {
      ticketId: number
      userId: string
      content: string
    }) => api.addComment(ticketId, userId, content),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: keys.comments(variables.ticketId) }),
  })
}

export function useDeleteComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ commentId }: { commentId: number; ticketId: number }) =>
      api.deleteComment(commentId),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: keys.comments(variables.ticketId) }),
  })
}

export function useQueueReply() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.queueReply,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: keys.outbound(variables.ticketId) }),
  })
}

export function useCancelReply() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ emailId }: { emailId: number; ticketId: number }) =>
      api.cancelQueuedReply(emailId),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: keys.outbound(variables.ticketId) }),
  })
}

export function useDeleteTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ticketId: number) => api.deleteTicket(ticketId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] })
      void queryClient.invalidateQueries({ queryKey: keys.leadTimes })
    },
  })
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' }) =>
      api.updateUserRole(userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.users }),
  })
}

// ---------------------------------------------------------------------------
// desk 스냅샷 · 태스크 맵
// ---------------------------------------------------------------------------

/**
 * 스냅샷은 수백 KB 라 자주 다시 받지 않습니다. 어차피 주 2회만 바뀝니다.
 */
export function useLatestSnapshot() {
  return useQuery({
    queryKey: keys.snapshot,
    queryFn: api.fetchLatestSnapshot,
    staleTime: 600_000,
  })
}

export function useSnapshotDays() {
  return useQuery({ queryKey: keys.snapshotDays, queryFn: api.fetchSnapshotDays, staleTime: 600_000 })
}

/** 주간 diff 의 기준 스냅샷. 구간 시작일이 정해져야 부를 수 있습니다 */
export function useSnapshotBefore(day: string | null) {
  return useQuery({
    queryKey: ['desk-snapshot-before', day],
    queryFn: () => api.fetchSnapshotBefore(day!),
    enabled: Boolean(day),
    staleTime: 600_000,
  })
}

export function useTaskMap() {
  return useQuery({ queryKey: keys.taskMap, queryFn: api.fetchTaskMap })
}

/**
 * 저장에 성공하면 서버가 돌려준 행으로 캐시를 **바로 갈아 끼웁니다.**
 * 다시 조회하지 않는 이유는 낙관적 잠금 때문입니다 — 방금 저장한 `updated_at`
 * 을 손에 쥐고 있어야 이어서 저장할 수 있습니다.
 */
export function useSaveTaskMap() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.saveTaskMap,
    onSuccess: (row) => {
      queryClient.setQueryData(keys.taskMap, row)
    },
  })
}
