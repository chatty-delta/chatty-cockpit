<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@/api'

const email = ref('')
const sent = ref(false)
const error = ref('')
const loading = ref(false)

async function requestMagicLink() {
  if (!email.value) return
  
  loading.value = true
  error.value = ''
  
  try {
    await api.requestMagicLink(email.value)
    sent.value = true
  } catch (e) {
    error.value = 'Fehler beim Senden des Magic Links'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <span class="text-6xl">💬</span>
        <h1 class="text-3xl font-bold mt-4 bg-gradient-to-r from-chatty-500 to-orange-400 bg-clip-text text-transparent">
          Chatty Cockpit
        </h1>
        <p class="text-slate-400 mt-2">Dein persönliches AI-Dashboard</p>
      </div>

      <div class="bg-slate-800/50 backdrop-blur rounded-2xl p-8 border border-slate-700">
        <template v-if="!sent">
          <h2 class="text-xl font-semibold mb-6">Anmelden</h2>
          
          <form @submit.prevent="requestMagicLink">
            <label class="block text-sm text-slate-400 mb-2">Email-Adresse</label>
            <input
              v-model="email"
              type="email"
              placeholder="name@example.com"
              class="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:outline-none focus:border-chatty-500 transition"
              :disabled="loading"
            />
            
            <p v-if="error" class="text-red-400 text-sm mt-2">{{ error }}</p>
            
            <button
              type="submit"
              :disabled="loading || !email"
              class="w-full mt-6 px-4 py-3 bg-chatty-500 hover:bg-chatty-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition"
            >
              {{ loading ? 'Wird gesendet...' : 'Magic Link senden' }}
            </button>
          </form>
        </template>

        <template v-else>
          <div class="text-center">
            <span class="text-5xl">✉️</span>
            <h2 class="text-xl font-semibold mt-4">Check deine Mails!</h2>
            <p class="text-slate-400 mt-2">
              Wir haben einen Magic Link an<br>
              <span class="text-chatty-400">{{ email }}</span><br>
              gesendet.
            </p>
            <button
              @click="sent = false; email = ''"
              class="mt-6 text-sm text-slate-400 hover:text-white transition"
            >
              Andere Email verwenden
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
