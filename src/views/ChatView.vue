<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useRouter } from 'vue-router'
import { api } from '@/api'
import ChatMessage from '@/components/ChatMessage.vue'

const auth = useAuthStore()
const chat = useChatStore()
const router = useRouter()

const input = ref('')
const messagesContainer = ref<HTMLElement | null>(null)

async function sendMessage() {
  const content = input.value.trim()
  if (!content || chat.isLoading) return
  
  input.value = ''
  chat.addMessage({ role: 'user', content })
  
  await scrollToBottom()
  
  chat.setLoading(true)
  
  try {
    const response = await api.sendMessage(content)
    chat.addMessage({ role: 'assistant', content: response.message })
  } catch (e) {
    chat.addMessage({ 
      role: 'assistant', 
      content: '❌ Fehler bei der Verbindung. Bitte versuche es erneut.' 
    })
  } finally {
    chat.setLoading(false)
    await scrollToBottom()
  }
}

async function scrollToBottom() {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

function logout() {
  auth.logout()
  chat.clearMessages()
  router.push('/login')
}

onMounted(() => {
  if (chat.messages.length === 0) {
    chat.addMessage({
      role: 'assistant',
      content: 'Hey! 👋 Willkommen im Cockpit. Wie kann ich dir helfen?'
    })
  }
})
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- Header -->
    <header class="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-800/50">
      <div class="flex items-center gap-3">
        <span class="text-3xl">💬</span>
        <div>
          <h1 class="font-semibold">Chatty Cockpit</h1>
          <p class="text-xs text-slate-400">{{ auth.user?.email }}</p>
        </div>
      </div>
      <button
        @click="logout"
        class="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition"
      >
        Abmelden
      </button>
    </header>

    <!-- Messages -->
    <div 
      ref="messagesContainer"
      class="flex-1 overflow-y-auto p-6 space-y-4"
    >
      <ChatMessage
        v-for="msg in chat.messages"
        :key="msg.id"
        :message="msg"
      />
      
      <div v-if="chat.isLoading" class="flex items-center gap-2 text-slate-400">
        <span class="animate-bounce">💬</span>
        <span>Chatty denkt nach...</span>
      </div>
    </div>

    <!-- Input -->
    <div class="p-4 border-t border-slate-700 bg-slate-800/50">
      <form @submit.prevent="sendMessage" class="flex gap-3">
        <input
          v-model="input"
          type="text"
          placeholder="Schreib mir etwas..."
          class="flex-1 px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl focus:outline-none focus:border-chatty-500 transition"
          :disabled="chat.isLoading"
        />
        <button
          type="submit"
          :disabled="chat.isLoading || !input.trim()"
          class="px-6 py-3 bg-chatty-500 hover:bg-chatty-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium transition"
        >
          Senden
        </button>
      </form>
    </div>
  </div>
</template>
