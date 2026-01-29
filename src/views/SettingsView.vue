<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// Theme
type Theme = 'dark' | 'light' | 'system'
const theme = ref<Theme>('dark')

// Notification settings
const notificationsEnabled = ref(false)
const notificationPermission = ref<NotificationPermission>('default')

// Preferences
const preferences = ref({
  compactMode: false,
  showSeconds: false,
  defaultView: 'dashboard',
  language: 'de'
})

// Load settings from localStorage
onMounted(() => {
  const savedTheme = localStorage.getItem('cockpit-theme') as Theme
  if (savedTheme) theme.value = savedTheme
  
  const savedPrefs = localStorage.getItem('cockpit-preferences')
  if (savedPrefs) {
    try {
      preferences.value = { ...preferences.value, ...JSON.parse(savedPrefs) }
    } catch {}
  }

  // Check notification permission
  if ('Notification' in window) {
    notificationPermission.value = Notification.permission
    notificationsEnabled.value = Notification.permission === 'granted'
  }

  applyTheme()
})

// Watch and save settings
watch(theme, (val) => {
  localStorage.setItem('cockpit-theme', val)
  applyTheme()
})

watch(preferences, (val) => {
  localStorage.setItem('cockpit-preferences', JSON.stringify(val))
}, { deep: true })

function applyTheme() {
  const root = document.documentElement
  if (theme.value === 'light') {
    root.classList.remove('dark')
  } else {
    root.classList.add('dark')
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('Dein Browser unterstützt keine Benachrichtigungen')
    return
  }

  const permission = await Notification.requestPermission()
  notificationPermission.value = permission
  notificationsEnabled.value = permission === 'granted'

  if (permission === 'granted') {
    new Notification('Benachrichtigungen aktiviert! 🎉', {
      body: 'Du erhältst jetzt Reminder-Benachrichtigungen',
      icon: '/favicon.ico'
    })
  }
}

function testNotification() {
  if (notificationsEnabled.value) {
    new Notification('Test Benachrichtigung 🔔', {
      body: 'Benachrichtigungen funktionieren!',
      icon: '/favicon.ico'
    })
  }
}

// Export data
async function exportData() {
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      localStorage: { ...localStorage }
    }
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cockpit-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    alert('Export fehlgeschlagen')
  }
}

// Clear local data
function clearLocalData() {
  if (confirm('Alle lokalen Daten löschen? (Server-Daten bleiben erhalten)')) {
    const token = localStorage.getItem('auth_token')
    localStorage.clear()
    if (token) localStorage.setItem('auth_token', token)
    location.reload()
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <h1 class="text-2xl font-bold">⚙️ Einstellungen</h1>

      <!-- Theme -->
      <section class="bg-gray-800/50 rounded-xl p-5">
        <h2 class="font-semibold mb-4 flex items-center gap-2">
          🎨 Erscheinungsbild
        </h2>
        
        <div class="space-y-4">
          <div>
            <label class="text-sm text-gray-400 mb-2 block">Theme</label>
            <div class="flex gap-2">
              <button
                v-for="t in ['dark', 'light'] as const"
                :key="t"
                @click="theme = t"
                :class="[
                  'px-4 py-2 rounded-lg transition-colors capitalize',
                  theme === t 
                    ? 'bg-rose-500 text-white' 
                    : 'bg-gray-700 hover:bg-gray-600'
                ]"
              >
                {{ t === 'dark' ? '🌙 Dunkel' : '☀️ Hell' }}
              </button>
            </div>
          </div>

          <label class="flex items-center gap-3 cursor-pointer">
            <input 
              type="checkbox" 
              v-model="preferences.compactMode"
              class="w-5 h-5 rounded bg-gray-700 border-gray-600 text-rose-500 focus:ring-rose-500"
            >
            <span>Kompakter Modus</span>
          </label>
        </div>
      </section>

      <!-- Notifications -->
      <section class="bg-gray-800/50 rounded-xl p-5">
        <h2 class="font-semibold mb-4 flex items-center gap-2">
          🔔 Benachrichtigungen
        </h2>
        
        <div class="space-y-4">
          <div v-if="notificationPermission === 'denied'" class="text-amber-400 text-sm">
            ⚠️ Benachrichtigungen wurden blockiert. Bitte aktiviere sie in deinen Browser-Einstellungen.
          </div>
          
          <div v-else-if="!notificationsEnabled" class="space-y-3">
            <p class="text-gray-400 text-sm">
              Erhalte Benachrichtigungen für fällige Reminders.
            </p>
            <button
              @click="requestNotificationPermission"
              class="px-4 py-2 bg-rose-500 hover:bg-rose-600 rounded-lg transition-colors"
            >
              Benachrichtigungen aktivieren
            </button>
          </div>
          
          <div v-else class="space-y-3">
            <div class="flex items-center gap-2 text-green-400">
              <span>✅</span>
              <span>Benachrichtigungen sind aktiviert</span>
            </div>
            <button
              @click="testNotification"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm"
            >
              Test-Benachrichtigung senden
            </button>
          </div>
        </div>
      </section>

      <!-- Account -->
      <section class="bg-gray-800/50 rounded-xl p-5">
        <h2 class="font-semibold mb-4 flex items-center gap-2">
          👤 Account
        </h2>
        
        <div class="space-y-4">
          <div>
            <label class="text-sm text-gray-400 mb-1 block">E-Mail</label>
            <div class="text-lg">{{ auth.user?.email }}</div>
          </div>
          
          <div class="pt-2 border-t border-gray-700">
            <button
              @click="auth.logout()"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-rose-400"
            >
              🚪 Abmelden
            </button>
          </div>
        </div>
      </section>

      <!-- Data -->
      <section class="bg-gray-800/50 rounded-xl p-5">
        <h2 class="font-semibold mb-4 flex items-center gap-2">
          💾 Daten
        </h2>
        
        <div class="space-y-4">
          <div class="flex flex-wrap gap-3">
            <button
              @click="exportData"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm"
            >
              📤 Einstellungen exportieren
            </button>
            <button
              @click="clearLocalData"
              class="px-4 py-2 bg-gray-700 hover:bg-red-600/50 rounded-lg transition-colors text-sm text-red-400"
            >
              🗑️ Lokale Daten löschen
            </button>
          </div>
          <p class="text-xs text-gray-500">
            Hinweis: Deine Server-Daten (Tasks, Events, Files, etc.) bleiben erhalten.
          </p>
        </div>
      </section>

      <!-- About -->
      <section class="bg-gray-800/50 rounded-xl p-5">
        <h2 class="font-semibold mb-4 flex items-center gap-2">
          ℹ️ Über
        </h2>
        
        <div class="space-y-2 text-sm text-gray-400">
          <p><strong class="text-white">Chatty Cockpit</strong> v1.0</p>
          <p>Dein persönliches Dashboard für alles, was wichtig ist.</p>
          <p class="pt-2">
            Built with 💜 by 
            <span class="text-rose-400">Chatty</span> & 
            <span class="text-white">Patrick</span>
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
