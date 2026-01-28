<script setup lang="ts">
import type { Message } from '@/stores/chat'

defineProps<{
  message: Message
}>()

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('de-AT', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
</script>

<template>
  <div
    class="flex gap-3"
    :class="message.role === 'user' ? 'flex-row-reverse' : ''"
  >
    <div
      class="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
      :class="message.role === 'user' ? 'bg-slate-700' : 'bg-chatty-500/20'"
    >
      {{ message.role === 'user' ? '👤' : '💬' }}
    </div>
    
    <div
      class="max-w-[70%] px-4 py-3 rounded-2xl"
      :class="message.role === 'user' 
        ? 'bg-chatty-500 text-white rounded-br-md' 
        : 'bg-slate-800 border border-slate-700 rounded-bl-md'"
    >
      <p class="whitespace-pre-wrap">{{ message.content }}</p>
      <p 
        class="text-xs mt-1 opacity-50"
        :class="message.role === 'user' ? 'text-right' : ''"
      >
        {{ formatTime(message.timestamp) }}
      </p>
    </div>
  </div>
</template>
