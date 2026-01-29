import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

export function useKeyboardShortcuts() {
  const router = useRouter()
  const pendingKey = ref<string | null>(null)
  const showHints = ref(false)

  // Two-key navigation shortcuts (g + key)
  const navShortcuts: Record<string, string> = {
    'd': '/dashboard',
    'c': '/chat',
    'r': '/reminders',
    'k': '/kanban',
    'a': '/calendar', // 'a' for Agenda/Calendar
    'f': '/files',
    'w': '/knowledge', // 'w' for Wiki
    's': '/settings',
  }

  let timeout: ReturnType<typeof setTimeout> | null = null

  function handleKeydown(e: KeyboardEvent) {
    // Ignore if typing in input/textarea
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target as HTMLElement)?.isContentEditable
    ) {
      return
    }

    // Cmd/Ctrl+K is handled by CommandPalette
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      return
    }

    const key = e.key.toLowerCase()

    // If we have a pending 'g' key
    if (pendingKey.value === 'g') {
      if (navShortcuts[key]) {
        e.preventDefault()
        router.push(navShortcuts[key])
      }
      pendingKey.value = null
      showHints.value = false
      if (timeout) clearTimeout(timeout)
      return
    }

    // Start a 'g' sequence
    if (key === 'g') {
      e.preventDefault()
      pendingKey.value = 'g'
      showHints.value = true
      
      // Clear after 1.5 seconds if no second key
      timeout = setTimeout(() => {
        pendingKey.value = null
        showHints.value = false
      }, 1500)
      return
    }

    // Question mark shows help
    if (key === '?' && !e.shiftKey) {
      // Could show a help modal
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
    if (timeout) clearTimeout(timeout)
  })

  return {
    pendingKey,
    showHints,
    navShortcuts
  }
}
