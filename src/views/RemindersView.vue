<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRemindersStore } from '@/stores/reminders'
import { api } from '@/api'

const store = useRemindersStore()

const showDone = ref(false)
const showCron = ref(true)
const createOpen = ref(false)

const title = ref('')
const body = ref('')
const dueAtLocal = ref('')

// Cron jobs
interface CronJob {
  id: string
  name: string
  enabled: boolean
  schedule: { kind: string; expr?: string; everyMs?: number; tz?: string }
  payload: { message: string; deliver?: boolean; channel?: string }
  state?: { nextRunAtMs?: number; lastRunAtMs?: number; lastStatus?: string }
}
const cronJobs = ref<CronJob[]>([])
const cronLoading = ref(false)

const openSorted = computed(() =>
  store.openReminders
    .slice()
    .sort((a, b) => (Date.parse(a.dueAt) || 0) - (Date.parse(b.dueAt) || 0))
)

const doneSorted = computed(() =>
  store.doneReminders
    .slice()
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
)

const enabledCronJobs = computed(() => 
  cronJobs.value.filter(j => j.enabled).sort((a, b) => {
    const nextA = a.state?.nextRunAtMs || 0
    const nextB = b.state?.nextRunAtMs || 0
    return nextA - nextB
  })
)

const disabledCronJobs = computed(() => 
  cronJobs.value.filter(j => !j.enabled).sort((a, b) => a.name.localeCompare(b.name))
)

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function formatMs(ms: number) {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '-'
  }
}

function formatSchedule(schedule: CronJob['schedule']): string {
  if (schedule.kind === 'cron') {
    return `⏰ ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`
  } else if (schedule.kind === 'every') {
    const mins = Math.round((schedule.everyMs || 0) / 60000)
    if (mins < 60) return `🔄 every ${mins}m`
    return `🔄 every ${Math.round(mins / 60)}h`
  }
  return schedule.kind
}

async function fetchCronJobs() {
  cronLoading.value = true
  try {
    const data = await api.get<{ jobs: CronJob[] }>('/api/cron')
    cronJobs.value = data.jobs || []
  } catch (e) {
    console.error('Failed to fetch cron jobs:', e)
  } finally {
    cronLoading.value = false
  }
}

async function toggleCronJob(id: string, enabled: boolean) {
  try {
    await api.patch(`/api/cron/${id}`, { enabled })
    await fetchCronJobs()
  } catch (e: any) {
    alert(e?.message || 'Failed to update cron job')
  }
}

async function deleteCronJob(id: string, name: string) {
  if (!confirm(`Cron-Job "${name}" wirklich löschen?`)) return
  try {
    await api.delete(`/api/cron/${id}`)
    await fetchCronJobs()
  } catch (e: any) {
    alert(e?.message || 'Failed to delete cron job')
  }
}

async function submitCreate() {
  if (!title.value.trim()) return
  const dueAt = dueAtLocal.value ? new Date(dueAtLocal.value).toISOString() : undefined
  await store.create({
    title: title.value.trim(),
    body: body.value.trim() || undefined,
    dueAt,
  })
  title.value = ''
  body.value = ''
  dueAtLocal.value = ''
  createOpen.value = false
}

async function toggleDone(id: string, next: 'open' | 'done') {
  await store.update(id, { status: next })
}

async function deleteReminder(id: string) {
  await store.remove(id)
}

onMounted(async () => {
  await Promise.all([store.fetchAll(), fetchCronJobs()])
})
</script>

<template>
  <div class="h-full flex flex-col bg-gray-900 text-white">
    <header class="p-4 border-b border-gray-700 flex items-center gap-3 flex-wrap">
      <h1 class="text-lg font-semibold">📌 Reminders</h1>
      <span class="text-xs text-gray-400">Open: {{ store.openCount }}</span>
      <span class="text-xs text-gray-400">⏰ {{ enabledCronJobs.length }} Jobs</span>
      <div class="ml-auto flex items-center gap-2">
        <button
          @click="createOpen = true"
          class="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-sm font-medium"
        >
          + New
        </button>
        <button
          @click="showCron = !showCron"
          class="px-3 py-2 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-sm"
        >
          {{ showCron ? 'Hide cron' : 'Show cron' }}
        </button>
        <button
          @click="showDone = !showDone"
          class="px-3 py-2 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-sm"
        >
          {{ showDone ? 'Hide done' : 'Show done' }}
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-auto p-4 space-y-6">
      <!-- Cron Jobs -->
      <div v-if="showCron">
        <div class="text-xs uppercase tracking-wider text-gray-400 mb-2">⏰ Scheduled Jobs (Cron)</div>
        <div v-if="cronLoading" class="text-gray-400 text-sm">Loading…</div>
        <div v-else-if="enabledCronJobs.length === 0" class="text-gray-500 text-sm">No cron jobs.</div>
        <div v-else class="space-y-3">
          <div
            v-for="job in enabledCronJobs"
            :key="job.id"
            class="p-4 rounded-xl bg-indigo-900/30 border border-indigo-700/50"
          >
            <div class="flex items-start gap-3">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <div class="font-semibold">{{ job.name }}</div>
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-700/50 text-indigo-200">cron</span>
                  <span v-if="job.payload.deliver" class="text-[10px] px-2 py-0.5 rounded-full bg-green-700/50 text-green-200">📨 delivers</span>
                </div>
                <div class="text-sm text-gray-300 mt-1">{{ formatSchedule(job.schedule) }}</div>
                <div class="text-xs text-gray-500 mt-2 space-x-3">
                  <span v-if="job.state?.nextRunAtMs">Next: {{ formatMs(job.state.nextRunAtMs) }}</span>
                  <span v-if="job.state?.lastRunAtMs">Last: {{ formatMs(job.state.lastRunAtMs) }}</span>
                  <span v-if="job.state?.lastStatus" :class="job.state.lastStatus === 'ok' ? 'text-green-400' : 'text-red-400'">
                    {{ job.state.lastStatus }}
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="toggleCronJob(job.id, false)"
                  class="px-3 py-1.5 rounded-lg bg-yellow-600/80 hover:bg-yellow-600 text-sm"
                  title="Deaktivieren"
                >
                  ⏸️ Pause
                </button>
                <button
                  @click="deleteCronJob(job.id, job.name)"
                  class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-red-600 text-sm"
                  title="Löschen"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Disabled/Paused Cron Jobs -->
        <div v-if="disabledCronJobs.length > 0" class="mt-4">
          <div class="text-xs uppercase tracking-wider text-gray-500 mb-2">⏸️ Paused Jobs</div>
          <div class="space-y-2">
            <div
              v-for="job in disabledCronJobs"
              :key="job.id"
              class="p-3 rounded-xl bg-gray-800/40 border border-gray-700/50 opacity-60"
            >
              <div class="flex items-center gap-3">
                <div class="flex-1">
                  <div class="font-semibold text-gray-400">{{ job.name }}</div>
                  <div class="text-xs text-gray-500">{{ formatSchedule(job.schedule) }}</div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    @click="toggleCronJob(job.id, true)"
                    class="px-3 py-1.5 rounded-lg bg-green-600/80 hover:bg-green-600 text-sm"
                    title="Aktivieren"
                  >
                    ▶️ Resume
                  </button>
                  <button
                    @click="deleteCronJob(job.id, job.name)"
                    class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-red-600 text-sm"
                    title="Löschen"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Open Reminders -->
      <div>
        <div class="text-xs uppercase tracking-wider text-gray-400 mb-2">Open</div>
        <div v-if="store.isLoading" class="text-gray-400 text-sm">Loading…</div>
        <div v-else-if="openSorted.length === 0" class="text-gray-500 text-sm">No open reminders.</div>

        <div v-else class="space-y-3">
          <div
            v-for="r in openSorted"
            :key="r.id"
            class="p-4 rounded-xl bg-gray-800/70 border border-gray-700"
          >
            <div class="flex items-start gap-3">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <div class="font-semibold">{{ r.title }}</div>
                  <span
                    v-if="r.source"
                    class="text-[10px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-200"
                    >{{ r.source }}</span
                  >
                </div>
                <div v-if="r.body" class="text-sm text-gray-300 mt-1 whitespace-pre-wrap">{{ r.body }}</div>
                <div class="text-xs text-gray-500 mt-2">
                  Due: {{ formatDate(r.dueAt) }}
                </div>
              </div>

              <div class="flex items-center gap-2">
                <button
                  @click="toggleDone(r.id, 'done')"
                  class="px-3 py-1.5 rounded-lg bg-green-600/80 hover:bg-green-600 text-sm"
                >
                  Done
                </button>
                <button
                  @click="deleteReminder(r.id)"
                  class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="showDone">
        <div class="text-xs uppercase tracking-wider text-gray-400 mb-2">Done</div>
        <div v-if="doneSorted.length === 0" class="text-gray-500 text-sm">No done reminders.</div>
        <div v-else class="space-y-3">
          <div
            v-for="r in doneSorted"
            :key="r.id"
            class="p-4 rounded-xl bg-gray-800/40 border border-gray-700/60"
          >
            <div class="flex items-start gap-3">
              <div class="flex-1">
                <div class="font-semibold line-through text-gray-300">{{ r.title }}</div>
                <div v-if="r.body" class="text-sm text-gray-400 mt-1 whitespace-pre-wrap">{{ r.body }}</div>
                <div class="text-xs text-gray-500 mt-2">
                  Due: {{ formatDate(r.dueAt) }} · Updated: {{ formatDate(r.updatedAt) }}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="toggleDone(r.id, 'open')"
                  class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                >
                  Undo
                </button>
                <button
                  @click="deleteReminder(r.id)"
                  class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="createOpen" class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div class="w-full max-w-lg rounded-2xl bg-gray-900 border border-gray-700 shadow-xl">
        <div class="p-4 border-b border-gray-700 flex items-center">
          <div class="font-semibold">New reminder</div>
          <button
            class="ml-auto text-gray-400 hover:text-white"
            @click="createOpen = false"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div class="p-4 space-y-3">
          <div>
            <label class="text-xs text-gray-400">Title</label>
            <input
              v-model="title"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="Reminder title"
            />
          </div>

          <div>
            <label class="text-xs text-gray-400">Body (optional)</label>
            <textarea
              v-model="body"
              rows="3"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="More details…"
            />
          </div>

          <div>
            <label class="text-xs text-gray-400">Due at</label>
            <input
              v-model="dueAtLocal"
              type="datetime-local"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
            />
            <div class="text-[11px] text-gray-500 mt-1">If empty, "now" is used.</div>
          </div>
        </div>

        <div class="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
          <button
            @click="createOpen = false"
            class="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
          >
            Cancel
          </button>
          <button
            @click="submitCreate"
            class="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-sm font-medium"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
