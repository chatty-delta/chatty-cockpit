<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { useChatStore } from '@/stores/chat'
import { api } from '@/api'
import ChatMessage from '@/components/ChatMessage.vue'

const chat = useChatStore()

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

function clearChat() {
  if (confirm('Chat-Verlauf wirklich löschen?')) {
    chat.clearMessages()
    chat.addMessage({
      role: 'assistant',
      content: 'Hey! 👋 Chat wurde geleert. Wie kann ich dir helfen?'
    })
  }
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
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-700 bg-slate-800/50 flex-shrink-0">
      <div class="flex items-center">
        <span class="text-xl sm:text-2xl mr-2 sm:mr-3">💬</span>
        <h1 class="font-semibold text-base sm:text-lg">Chat</h1>
      </div>
      <button
        v-if="chat.messages.length > 1"
        @click="clearChat"
        class="text-xs text-gray-400 hover:text-red-400 transition-colors"
        title="Chat-Verlauf löschen"
      >
        🗑️ Verlauf löschen
      </button>
    </header>

    <!-- Messages -->
    <div 
      ref="messagesContainer"
      class="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 space-y-3 sm:space-y-4"
    >
      <ChatMessage
        v-for="msg in chat.messages"
        :key="msg.id"
        :message="msg"
      />
      
      <div v-if="chat.isLoading" class="flex items-center gap-2 text-slate-400">
        <span class="animate-bounce">💬</span>
        <span class="text-sm sm:text-base">Chatty denkt nach...</span>
      </div>
    </div>

    <!-- Input -->
    <div class="p-3 sm:p-4 border-t border-slate-700 bg-slate-800/50 flex-shrink-0">
      <form @submit.prevent="sendMessage" class="flex gap-2 sm:gap-3">
        <input
          v-model="input"
          type="text"
          placeholder="Schreib mir etwas..."
          class="flex-1 min-w-0 px-3 sm:px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl focus:outline-none focus:border-chatty-500 transition text-sm sm:text-base"
          :disabled="chat.isLoading"
        />
        <button
          type="submit"
          :disabled="chat.isLoading || !input.trim()"
          class="px-4 sm:px-6 py-3 bg-chatty-500 hover:bg-chatty-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium transition text-sm sm:text-base flex-shrink-0"
        >
          <span class="hidden sm:inline">Senden</span>
          <span class="sm:hidden">➤</span>
        </button>
      </form>
    </div>
  </div>
</template>
