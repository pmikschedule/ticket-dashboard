import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import * as api from '../lib/api'
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

export function useUpdateStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, status }: { ticketId: number; status: string }) =>
      api.updateTicketStatus(ticketId, status),
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
      patch: Partial<Pick<TicketMeta, 'category' | 'severity' | 'system_type' | 'assignee_id'>>
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
      patch: { subject?: string; description?: string; due_date?: string | null }
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
