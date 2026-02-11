import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/api-client'
import type { FreepbxServer, FreepbxUserList, FreepbxExtensionList, FreepbxBulkResult, FreepbxSystemMetrics } from '@/types/freepbx-manager'

export function useFreepbxServers() {
  return useQuery({
    queryKey: ['freepbx-servers-admin'],
    queryFn: async (): Promise<FreepbxServer[]> => {
      const response = await apiClient.get('/api/v1/admin/freepbx-servers')
      return response.data.servers || []
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  })
}

export function useCreateFreepbxServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      label: string
      host: string
      port?: number
      rootUsername?: string
      rootPassword: string
      webUrl?: string
      notes?: string
    }) => {
      const response = await apiClient.post('/api/v1/admin/freepbx-servers', payload)
      return response.data.server as FreepbxServer
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['freepbx-servers-admin'] })
    },
  })
}

export function useDeleteFreepbxServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/api/v1/admin/freepbx-servers/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['freepbx-servers-admin'] })
    },
  })
}

export function useTestFreepbxServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post(`/api/v1/admin/freepbx-servers/${id}/test`)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['freepbx-servers-admin'] })
    },
  })
}

export function useFreepbxUsers() {
  return useMutation({
    mutationFn: async (id: string): Promise<FreepbxUserList> => {
      const response = await apiClient.get(`/api/v1/admin/freepbx-servers/${id}/users`)
      return response.data as FreepbxUserList
    },
  })
}

export function useFreepbxExtensions() {
  return useMutation({
    mutationFn: async (id: string): Promise<FreepbxExtensionList> => {
      const response = await apiClient.get(`/api/v1/admin/freepbx-servers/${id}/extensions`)
      return response.data as FreepbxExtensionList
    },
  })
}

export function useCreateFreepbxUser() {
  return useMutation({
    mutationFn: async (payload: { id: string; username: string; password?: string }) => {
      const response = await apiClient.post(`/api/v1/admin/freepbx-servers/${payload.id}/users`, {
        username: payload.username,
        password: payload.password,
      })
      return response.data as { success: boolean; password: string }
    },
  })
}

export function useDeleteFreepbxUser() {
  return useMutation({
    mutationFn: async (payload: { id: string; username: string }) => {
      await apiClient.delete(`/api/v1/admin/freepbx-servers/${payload.id}/users/${payload.username}`)
    },
  })
}

export function useBulkCreateFreepbxUser() {
  return useMutation({
    mutationFn: async (payload: { pbxIds: string[]; username: string; password?: string }) => {
      const response = await apiClient.post('/api/v1/admin/freepbx-servers/bulk/users', payload)
      return response.data as FreepbxBulkResult
    },
  })
}

export function useBulkDeleteFreepbxUser() {
  return useMutation({
    mutationFn: async (payload: { pbxIds: string[]; username: string }) => {
      const response = await apiClient.delete('/api/v1/admin/freepbx-servers/bulk/users', { data: payload })
      return response.data as FreepbxBulkResult
    },
  })
}

export function useUpdateFreepbxUserPassword() {
  return useMutation({
    mutationFn: async ({ serverId, username, password }: { serverId: string; username: string; password: string }) => {
      const response = await apiClient.patch(`/api/v1/admin/freepbx-servers/${serverId}/users/${username}/password`, { password })
      return response.data
    },
  })
}

export function useFreepbxSystemMetrics() {
  return useMutation({
    mutationFn: async (id: string): Promise<FreepbxSystemMetrics> => {
      const response = await apiClient.get(`/api/v1/admin/freepbx-servers/${id}/metrics`)
      return response.data as FreepbxSystemMetrics
    },
  })
}

export function useUpdateFreepbxServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { 
      id: string
      updates: {
        label?: string
        host?: string
        port?: number
        rootUsername?: string
        rootPassword?: string
        webUrl?: string
        notes?: string
      }
    }) => {
      const response = await apiClient.patch(`/api/v1/admin/freepbx-servers/${id}`, updates)
      return response.data.server as FreepbxServer
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['freepbx-servers-admin'] })
    },
  })
}


