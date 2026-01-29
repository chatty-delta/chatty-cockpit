<script setup lang="ts">
import type { Message } from '@/stores/chat'

defineProps<{
  message: Message
}>()

function formatTime(timestamp: string | Date) {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  return new Intl.DateTimeFormat('de-AT', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
</script>

<template>
  <div
    class="flex gap-2 sm:gap-3"
    :class="message.role === 'user' ? 'flex-row-reverse' : ''"
  >
    <div
      class="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-base sm:text-xl shrink-0"
      :class="message.role === 'user' ? 'bg-slate-700' : 'bg-chatty-500/20'"
    >
      {{ message.role === 'user' ? '👤' : '💬' }}
    </div>
    
    <div
      class="max-w-[85%] sm:max-w-[70%] px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl"
      :class="message.role === 'user' 
        ? 'bg-chatty-500 text-white rounded-br-md' 
        : 'bg-slate-800 border border-slate-700 rounded-bl-md'"
    >
      <p class="whitespace-pre-wrap text-sm sm:text-base break-words">{{ message.content }}</p>
      <p 
        class="text-[10px] sm:text-xs mt-1 opacity-50"
        :class="message.role === 'user' ? 'text-right' : ''"
      >
        {{ formatTime(message.timestamp) }}
      </p>
    </div>
  </div>
</template>
