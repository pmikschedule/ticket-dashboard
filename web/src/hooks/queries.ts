import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import * as api from '../lib/api'
import type { Resolution } from '../lib/constants'
import type { TicketFilters, TicketMeta } from '../lib/types'

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

export function useMarkReviewed() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, userId, note }: { id: number; userId: string; note?: string }) =>
      api.markScanReviewed(id, userId, note),
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
      patch: {
        subject?: string
        description?: string
        due_date?: string | null
        planned_start_date?: string | null
        planned_end_date?: string | null
      }
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
