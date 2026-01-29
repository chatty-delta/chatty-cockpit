import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api'

export type ReminderStatus = 'open' | 'done'
export type ReminderSource = 'manual' | 'cron' | 'telegram'

export interface Reminder {
  id: string
  title: string
  body?: string
  dueAt: string
  status: ReminderStatus
  createdAt: string
  updatedAt: string
  source?: ReminderSource
  tags?: string[]
}

export const useRemindersStore = defineStore('reminders', () => {
  const reminders = ref<Reminder[]>([])
  const isLoading = ref(false)

  const openReminders = computed(() => reminders.value.filter(r => r.status === 'open'))
  const doneReminders = computed(() => reminders.value.filter(r => r.status === 'done'))
  const openCount = computed(() => openReminders.value.length)

  async function fetchAll() {
    isLoading.value = true
    try {
      const data = await api.get<{ reminders: Reminder[] }>('/api/reminders?status=all')
      reminders.value = data.reminders || []
    } finally {
      isLoading.value = false
    }
  }

  async function create(input: { title: string; body?: string; dueAt?: string; tags?: string[] }) {
    const data = await api.post<{ reminder: Reminder }>('/api/reminders', input)
    reminders.value = [...reminders.value, data.reminder]
  }

  async function update(id: string, patch: { title?: string; body?: string; dueAt?: string; status?: ReminderStatus }) {
    const data = await api.patch<{ reminder: Reminder }>(`/api/reminders/${id}`, patch)
    reminders.value = reminders.value.map(r => (r.id === id ? data.reminder : r))
  }

  async function remove(id: string) {
    await api.delete(`/api/reminders/${id}`)
    reminders.value = reminders.value.filter(r => r.id !== id)
  }

  return {
    reminders,
    isLoading,
    openReminders,
    doneReminders,
    openCount,
    fetchAll,
    create,
    update,
    remove,
  }
})
