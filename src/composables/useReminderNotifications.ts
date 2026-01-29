import { onMounted, onUnmounted, watch } from 'vue'
import { useRemindersStore } from '@/stores/reminders'

const NOTIFICATION_STORAGE_KEY = 'cockpit-notified-reminders'
const CHECK_INTERVAL = 60000 // 1 minute

export function useReminderNotifications() {
  const reminders = useRemindersStore()
  let checkInterval: ReturnType<typeof setInterval> | null = null

  // Get already notified reminder IDs
  function getNotifiedIds(): Set<string> {
    try {
      const stored = localStorage.getItem(NOTIFICATION_STORAGE_KEY)
      if (stored) {
        return new Set(JSON.parse(stored))
      }
    } catch {}
    return new Set()
  }

  // Save notified ID
  function markAsNotified(id: string) {
    const notified = getNotifiedIds()
    notified.add(id)
    // Keep only last 100 to prevent storage overflow
    const arr = Array.from(notified).slice(-100)
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(arr))
  }

  // Check for due reminders
  function checkDueReminders() {
    if (Notification.permission !== 'granted') return

    const now = new Date()
    const notified = getNotifiedIds()

    reminders.openReminders.forEach(reminder => {
      if (notified.has(reminder.id)) return

      const dueAt = new Date(reminder.dueAt)
      const diff = dueAt.getTime() - now.getTime()

      // Notify if due within the next 5 minutes or overdue
      if (diff <= 5 * 60 * 1000) {
        showNotification(reminder)
        markAsNotified(reminder.id)
      }
    })
  }

  function showNotification(reminder: { id: string; title: string; body?: string; dueAt: string }) {
    const dueAt = new Date(reminder.dueAt)
    const isOverdue = dueAt < new Date()
    
    const notification = new Notification(
      isOverdue ? `⏰ Überfällig: ${reminder.title}` : `📌 ${reminder.title}`,
      {
        body: reminder.body || (isOverdue 
          ? `War fällig um ${dueAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
          : `Fällig um ${dueAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
        ),
        icon: '/favicon.svg',
        tag: `reminder-${reminder.id}`,
        requireInteraction: isOverdue
      }
    )

    notification.onclick = () => {
      window.focus()
      window.location.href = '/reminders'
      notification.close()
    }
  }

  onMounted(async () => {
    // Initial fetch
    await reminders.fetchAll().catch(() => {})

    // Check immediately
    if (Notification.permission === 'granted') {
      checkDueReminders()
    }

    // Set up interval
    checkInterval = setInterval(() => {
      if (Notification.permission === 'granted') {
        reminders.fetchAll().catch(() => {})
        checkDueReminders()
      }
    }, CHECK_INTERVAL)
  })

  onUnmounted(() => {
    if (checkInterval) {
      clearInterval(checkInterval)
    }
  })

  // Also check when reminders change
  watch(() => reminders.openReminders, () => {
    if (Notification.permission === 'granted') {
      checkDueReminders()
    }
  })
}
