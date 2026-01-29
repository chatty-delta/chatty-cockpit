const API_BASE = import.meta.env.VITE_API_URL || ''

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token')
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`)
  }
  
  return response.json()
}

export const api = {
  get<T = any>(endpoint: string) {
    return request<T>(endpoint, { method: 'GET' })
  },
  
  post<T = any>(endpoint: string, data?: any) {
    return request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  },
  
  patch<T = any>(endpoint: string, data?: any) {
    return request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  put<T = any>(endpoint: string, data?: any) {
    return request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  },
  
  delete<T = any>(endpoint: string) {
    return request<T>(endpoint, { method: 'DELETE' })
  },

  async requestMagicLink(email: string) {
    return this.post<{ success: boolean }>('/api/auth/magic-link', { email })
  },

  async verifyMagicLink(token: string) {
    return this.post<{ token: string; email: string }>('/api/auth/verify', { token })
  },

  async sendMessage(message: string) {
    return this.post<{ message: string }>('/api/chat/message', { message })
  },
}
