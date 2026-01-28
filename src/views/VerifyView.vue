<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const status = ref<'verifying' | 'success' | 'error'>('verifying')
const error = ref('')

onMounted(async () => {
  const token = route.query.token as string
  
  if (!token) {
    status.value = 'error'
    error.value = 'Kein Token gefunden'
    return
  }
  
  try {
    const result = await api.verifyMagicLink(token)
    auth.setToken(result.token)
    auth.setUser({ email: result.email })
    status.value = 'success'
    
    setTimeout(() => {
      router.push('/chat')
    }, 1500)
  } catch (e) {
    status.value = 'error'
    error.value = 'Token ungültig oder abgelaufen'
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="text-center">
      <template v-if="status === 'verifying'">
        <div class="animate-spin text-5xl">⏳</div>
        <p class="mt-4 text-slate-400">Verifiziere...</p>
      </template>
      
      <template v-else-if="status === 'success'">
        <div class="text-5xl">✅</div>
        <h2 class="text-xl font-semibold mt-4">Erfolgreich angemeldet!</h2>
        <p class="text-slate-400 mt-2">Du wirst weitergeleitet...</p>
      </template>
      
      <template v-else>
        <div class="text-5xl">❌</div>
        <h2 class="text-xl font-semibold mt-4">Fehler</h2>
        <p class="text-slate-400 mt-2">{{ error }}</p>
        <router-link
          to="/login"
          class="inline-block mt-6 px-6 py-2 bg-chatty-500 hover:bg-chatty-600 rounded-lg transition"
        >
          Zurück zum Login
        </router-link>
      </template>
    </div>
  </div>
</template>
