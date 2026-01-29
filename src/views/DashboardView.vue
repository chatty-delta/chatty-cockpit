<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api'
import { useRemindersStore } from '@/stores/reminders'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const reminders = useRemindersStore()

// Stats
const stats = ref({
  openReminders: 0,
  todayEvents: 0,
  totalTasks: 0,
  filesCount: 0,
  articlesCount: 0
})

// Recent Activity (from activity log)
interface Activity {
  ts: string
  type: 'kanban' | 'calendar' | 'files'
  action: string
  summary: string
  userEmail?: string
}
const recentActivity = ref<Activity[]>([])

// Upcoming Reminders (next 7 days)
const upcomingReminders = computed(() => {
  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  
  return reminders.openReminders
    .filter((r: { status: string; dueAt: string }) => {
      const due = new Date(r.dueAt)
      return due >= now && due <= weekFromNow
    })
    .sort((a: { dueAt: string }, b: { dueAt: string }) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, 5)
})

// Today's date info
const today = computed(() => {
  const d = new Date()
  return {
    weekday: d.toLocaleDateString('de-DE', { weekday: 'long' }),
    date: d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }),
    greeting: getGreeting()
  }
})

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 6) return 'Gute Nacht'
  if (hour < 12) return 'Guten Morgen'
  if (hour < 18) return 'Guten Tag'
  return 'Guten Abend'
}

// Quick actions
const quickActions = [
  { icon: '💬', label: 'Neue Nachricht', action: () => router.push('/chat') },
  { icon: '📌', label: 'Reminder erstellen', action: () => router.push('/reminders') },
  { icon: '📋', label: 'Task hinzufügen', action: () => router.push('/kanban') },
  { icon: '📅', label: 'Termin planen', action: () => router.push('/calendar') },
]

// Format relative time
function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.round(diffMs / 60000)
  const diffHours = Math.round(diffMs / 3600000)
  const diffDays = Math.round(diffMs / 86400000)

  if (diffMins < 0) {
    // Past
    if (diffMins > -60) return `vor ${-diffMins} Min`
    if (diffHours > -24) return `vor ${-diffHours} Std`
    return `vor ${-diffDays} Tagen`
  } else {
    // Future
    if (diffMins < 60) return `in ${diffMins} Min`
    if (diffHours < 24) return `in ${diffHours} Std`
    if (diffDays === 1) return 'morgen'
    return `in ${diffDays} Tagen`
  }
}

// Activity icon mapping
function getActivityIcon(type: string, action: string) {
  const icons: Record<string, string> = {
    'kanban-created': '➕',
    'kanban-moved': '↔️',
    'kanban-edited': '✏️',
    'kanban-deleted': '🗑️',
    'calendar-created': '📅',
    'calendar-edited': '✏️',
    'calendar-deleted': '🗑️',
    'files-uploaded': '📤',
    'files-folder_created': '📁',
    'files-deleted': '🗑️',
    'files-renamed': '✏️',
    'files-file_moved': '↔️'
  }
  return icons[`${type}-${action}`] || '📝'
}

// Load data
const loading = ref(true)

onMounted(async () => {
  try {
    // Fetch reminders
    await reminders.fetchAll()
    stats.value.openReminders = reminders.openCount

    // Fetch tasks
    try {
      const tasksRes = await api.get('/api/kanban/tasks')
      stats.value.totalTasks = tasksRes.data.tasks?.length || 0
    } catch {}

    // Fetch today's events
    try {
      const month = new Date().toISOString().slice(0, 7)
      const eventsRes = await api.get(`/api/calendar/events?month=${month}`)
      const todayStr = new Date().toISOString().slice(0, 10)
      stats.value.todayEvents = eventsRes.data.events?.filter((e: any) => 
        e.start.startsWith(todayStr)
      ).length || 0
    } catch {}

    // Fetch files count
    try {
      const filesRes = await api.get('/api/files/list')
      stats.value.filesCount = filesRes.data.items?.length || 0
    } catch {}

    // Fetch articles count
    try {
      const articlesRes = await api.get('/api/knowledge')
      stats.value.articlesCount = articlesRes.data.articles?.length || 0
    } catch {}

    // TODO: Fetch activity log when endpoint is available

  } catch (e) {
    console.error('Dashboard load error:', e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold">
            {{ today.greeting }}, {{ auth.user?.email?.split('@')[0] || 'Patrick' }}! 👋
          </h1>
          <p class="text-gray-400 text-sm">
            {{ today.weekday }}, {{ today.date }}
          </p>
        </div>
        
        <!-- Quick Actions -->
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="action in quickActions"
            :key="action.label"
            @click="action.action"
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-sm"
          >
            <span>{{ action.icon }}</span>
            <span class="hidden sm:inline">{{ action.label }}</span>
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <router-link 
          to="/reminders" 
          class="bg-gray-800/50 rounded-xl p-4 hover:bg-gray-800 transition-colors group"
        >
          <div class="text-3xl mb-2">📌</div>
          <div class="text-2xl font-bold">{{ stats.openReminders }}</div>
          <div class="text-sm text-gray-400 group-hover:text-gray-300">Offene Reminders</div>
        </router-link>

        <router-link 
          to="/calendar" 
          class="bg-gray-800/50 rounded-xl p-4 hover:bg-gray-800 transition-colors group"
        >
          <div class="text-3xl mb-2">📅</div>
          <div class="text-2xl font-bold">{{ stats.todayEvents }}</div>
          <div class="text-sm text-gray-400 group-hover:text-gray-300">Termine heute</div>
        </router-link>

        <router-link 
          to="/kanban" 
          class="bg-gray-800/50 rounded-xl p-4 hover:bg-gray-800 transition-colors group"
        >
          <div class="text-3xl mb-2">📋</div>
          <div class="text-2xl font-bold">{{ stats.totalTasks }}</div>
          <div class="text-sm text-gray-400 group-hover:text-gray-300">Tasks gesamt</div>
        </router-link>

        <router-link 
          to="/files" 
          class="bg-gray-800/50 rounded-xl p-4 hover:bg-gray-800 transition-colors group"
        >
          <div class="text-3xl mb-2">📁</div>
          <div class="text-2xl font-bold">{{ stats.filesCount }}</div>
          <div class="text-sm text-gray-400 group-hover:text-gray-300">Dateien</div>
        </router-link>

        <router-link 
          to="/knowledge" 
          class="bg-gray-800/50 rounded-xl p-4 hover:bg-gray-800 transition-colors group"
        >
          <div class="text-3xl mb-2">📚</div>
          <div class="text-2xl font-bold">{{ stats.articlesCount }}</div>
          <div class="text-sm text-gray-400 group-hover:text-gray-300">Wiki-Artikel</div>
        </router-link>
      </div>

      <!-- Main Content Grid -->
      <div class="grid md:grid-cols-2 gap-6">
        <!-- Upcoming Reminders -->
        <div class="bg-gray-800/50 rounded-xl p-5">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-semibold flex items-center gap-2">
              <span>📌</span> Anstehende Reminders
            </h2>
            <router-link to="/reminders" class="text-sm text-rose-400 hover:text-rose-300">
              Alle →
            </router-link>
          </div>
          
          <div v-if="loading" class="text-gray-500 text-center py-8">
            Laden...
          </div>
          
          <div v-else-if="upcomingReminders.length === 0" class="text-gray-500 text-center py-8">
            Keine anstehenden Reminders 🎉
          </div>
          
          <div v-else class="space-y-3">
            <router-link
              v-for="reminder in upcomingReminders"
              :key="reminder.id"
              to="/reminders"
              class="block p-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate">{{ reminder.title }}</div>
                  <div class="text-sm text-gray-400">
                    {{ formatRelativeTime(reminder.dueAt) }}
                  </div>
                </div>
                <div 
                  v-if="reminder.tags?.length"
                  class="flex gap-1 flex-wrap justify-end"
                >
                  <span 
                    v-for="tag in reminder.tags.slice(0, 2)" 
                    :key="tag"
                    class="text-xs px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300"
                  >
                    {{ tag }}
                  </span>
                </div>
              </div>
            </router-link>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="bg-gray-800/50 rounded-xl p-5">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-semibold flex items-center gap-2">
              <span>⚡</span> Letzte Aktivitäten
            </h2>
          </div>
          
          <div v-if="recentActivity.length === 0" class="text-gray-500 text-center py-8">
            <p>Noch keine Aktivitäten</p>
            <p class="text-sm mt-2">Starte mit einer Aktion!</p>
          </div>
          
          <div v-else class="space-y-3">
            <div
              v-for="(activity, i) in recentActivity.slice(0, 5)"
              :key="i"
              class="flex items-start gap-3 p-3 rounded-lg bg-gray-700/50"
            >
              <span class="text-lg">{{ getActivityIcon(activity.type, activity.action) }}</span>
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{{ activity.summary }}</div>
                <div class="text-xs text-gray-500">
                  {{ formatRelativeTime(activity.ts) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chatty Section -->
      <div class="bg-gradient-to-br from-rose-500/20 to-purple-500/20 rounded-xl p-6 border border-rose-500/30">
        <div class="flex items-center gap-4">
          <div class="text-5xl">💬</div>
          <div class="flex-1">
            <h2 class="text-xl font-bold">Mit Chatty reden</h2>
            <p class="text-gray-400 text-sm mt-1">
              Frag mich was oder gib mir einen Auftrag!
            </p>
          </div>
          <router-link 
            to="/chat"
            class="px-4 py-2 bg-rose-500 hover:bg-rose-600 rounded-lg transition-colors font-medium"
          >
            Chat öffnen →
          </router-link>
        </div>
      </div>

      <!-- Footer -->
      <div class="text-center text-gray-600 text-sm py-4">
        Chatty Cockpit v1.0 • Built with 💜 by Chatty & Patrick
      </div>
    </div>
  </div>
</template>
