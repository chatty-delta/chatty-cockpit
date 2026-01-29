import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string // Changed to string for JSON serialization
}

const STORAGE_KEY = 'cockpit-chat-messages'
const MAX_MESSAGES = 100 // Keep last 100 messages

export const useChatStore = defineStore('chat', () => {
  // Load from localStorage
  const loadMessages = (): Message[] => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        return JSON.parse(saved)
      }
    } catch {}
    return []
  }

  const messages = ref<Message[]>(loadMessages())
  const isLoading = ref(false)

  // Persist to localStorage when messages change
  watch(messages, (newMessages) => {
    try {
      // Keep only last MAX_MESSAGES
      const toSave = newMessages.slice(-MAX_MESSAGES)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    } catch {}
  }, { deep: true })

  function addMessage(message: Omit<Message, 'id' | 'timestamp'>) {
    messages.value.push({
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    })
  }

  function setLoading(loading: boolean) {
    isLoading.value = loading
  }

  function clearMessages() {
    messages.value = []
    localStorage.removeItem(STORAGE_KEY)
  }

  return { messages, isLoading, addMessage, setLoading, clearMessages }
})
