const API_BASE = import.meta.env.VITE_API_URL || '/api'

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
  async requestMagicLink(email: string) {
    return request<{ success: boolean }>('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },

  async verifyMagicLink(token: string) {
    return request<{ token: string; email: string }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  },

  async sendMessage(message: string) {
    return request<{ message: string }>('/chat/message', {
      method: 'POST',
      body: JSON.stringify({ message }),
    })
  },
}
