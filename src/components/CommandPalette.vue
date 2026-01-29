<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const router = useRouter()
const searchQuery = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement>()

// Search results
interface SearchResult {
  type: 'nav' | 'reminder' | 'task' | 'article' | 'action'
  icon: string
  title: string
  subtitle?: string
  action: () => void
}

// Navigation items (always shown)
const navItems: SearchResult[] = [
  { type: 'nav', icon: '🏠', title: 'Dashboard', action: () => navigateTo('/dashboard') },
  { type: 'nav', icon: '💬', title: 'Chat', action: () => navigateTo('/chat') },
  { type: 'nav', icon: '📌', title: 'Reminders', action: () => navigateTo('/reminders') },
  { type: 'nav', icon: '📋', title: 'Kanban', action: () => navigateTo('/kanban') },
  { type: 'nav', icon: '📅', title: 'Kalender', action: () => navigateTo('/calendar') },
  { type: 'nav', icon: '📁', title: 'Files', action: () => navigateTo('/files') },
  { type: 'nav', icon: '📚', title: 'Wiki', action: () => navigateTo('/knowledge') },
  { type: 'nav', icon: '⚙️', title: 'Einstellungen', action: () => navigateTo('/settings') },
]

// Quick actions
const quickActions: SearchResult[] = [
  { type: 'action', icon: '➕', title: 'Neuer Reminder', subtitle: 'Reminder erstellen', action: () => navigateTo('/reminders?new=1') },
  { type: 'action', icon: '➕', title: 'Neuer Task', subtitle: 'Kanban Task erstellen', action: () => navigateTo('/kanban?new=1') },
  { type: 'action', icon: '➕', title: 'Neuer Termin', subtitle: 'Kalender Event erstellen', action: () => navigateTo('/calendar?new=1') },
  { type: 'action', icon: '➕', title: 'Neuer Artikel', subtitle: 'Wiki Artikel erstellen', action: () => navigateTo('/knowledge?new=1') },
]

// Dynamic search results
const reminders = ref<SearchResult[]>([])
const tasks = ref<SearchResult[]>([])
const articles = ref<SearchResult[]>([])

// Combined filtered results
const results = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  
  let items: SearchResult[] = []
  
  if (!q) {
    // Show nav and quick actions when empty
    items = [...navItems, ...quickActions]
  } else {
    // Filter nav items
    const filteredNav = navItems.filter(item => 
      item.title.toLowerCase().includes(q)
    )
    
    // Filter quick actions
    const filteredActions = quickActions.filter(item => 
      item.title.toLowerCase().includes(q) || 
      item.subtitle?.toLowerCase().includes(q)
    )
    
    // Filter dynamic results
    const filteredReminders = reminders.value.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.subtitle?.toLowerCase().includes(q)
    )
    
    const filteredTasks = tasks.value.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.subtitle?.toLowerCase().includes(q)
    )
    
    const filteredArticles = articles.value.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.subtitle?.toLowerCase().includes(q)
    )
    
    items = [
      ...filteredNav,
      ...filteredActions,
      ...filteredReminders,
      ...filteredTasks,
      ...filteredArticles
    ]
  }
  
  return items.slice(0, 10)
})

// Reset selection when results change
watch(results, () => {
  selectedIndex.value = 0
})

// Focus input when opened
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    searchQuery.value = ''
    selectedIndex.value = 0
    setTimeout(() => inputRef.value?.focus(), 50)
    loadSearchData()
  }
})

// Load search data
async function loadSearchData() {
  try {
    // Load reminders
    const remindersRes = await api.get('/api/reminders?status=open')
    reminders.value = (remindersRes.data.reminders || []).map((r: any) => ({
      type: 'reminder',
      icon: '📌',
      title: r.title,
      subtitle: `Reminder • ${new Date(r.dueAt).toLocaleDateString('de-DE')}`,
      action: () => navigateTo('/reminders')
    }))

    // Load tasks
    const tasksRes = await api.get('/api/kanban/tasks')
    tasks.value = (tasksRes.data.tasks || []).map((t: any) => ({
      type: 'task',
      icon: '📋',
      title: t.title,
      subtitle: `Task • ${t.column}`,
      action: () => navigateTo('/kanban')
    }))

    // Load articles
    const articlesRes = await api.get('/api/knowledge')
    articles.value = (articlesRes.data.articles || []).map((a: any) => ({
      type: 'article',
      icon: '📚',
      title: a.title,
      subtitle: `Wiki • ${a.folder || 'Root'}`,
      action: () => navigateTo(`/knowledge?id=${a.id}`)
    }))
  } catch (e) {
    console.error('Search data load error:', e)
  }
}

function navigateTo(path: string) {
  router.push(path)
  emit('close')
}

function selectResult(result: SearchResult) {
  result.action()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const result = results.value[selectedIndex.value]
    if (result) selectResult(result)
  } else if (e.key === 'Escape') {
    emit('close')
  }
}

// Global keyboard shortcut
function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    if (props.open) {
      emit('close')
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div 
        v-if="open"
        class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
        @click.self="$emit('close')"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="$emit('close')" />
        
        <!-- Dialog -->
        <div 
          class="relative w-full max-w-lg bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden"
          @keydown="handleKeydown"
        >
          <!-- Search Input -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
            <span class="text-gray-400">🔍</span>
            <input
              ref="inputRef"
              v-model="searchQuery"
              type="text"
              placeholder="Suchen oder Aktion ausführen..."
              class="flex-1 bg-transparent outline-none text-white placeholder-gray-500"
            >
            <kbd class="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 bg-gray-700 rounded">
              ESC
            </kbd>
          </div>
          
          <!-- Results -->
          <div class="max-h-80 overflow-y-auto py-2">
            <div v-if="results.length === 0" class="px-4 py-8 text-center text-gray-500">
              Keine Ergebnisse gefunden
            </div>
            
            <button
              v-for="(result, index) in results"
              :key="`${result.type}-${result.title}-${index}`"
              @click="selectResult(result)"
              :class="[
                'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                selectedIndex === index 
                  ? 'bg-rose-500/20 text-white' 
                  : 'hover:bg-gray-700/50 text-gray-300'
              ]"
            >
              <span class="text-lg flex-shrink-0">{{ result.icon }}</span>
              <div class="flex-1 min-w-0">
                <div class="truncate">{{ result.title }}</div>
                <div v-if="result.subtitle" class="text-xs text-gray-500 truncate">
                  {{ result.subtitle }}
                </div>
              </div>
              <span v-if="selectedIndex === index" class="text-xs text-gray-500">↵</span>
            </button>
          </div>
          
          <!-- Footer -->
          <div class="px-4 py-2 border-t border-gray-700 flex items-center gap-4 text-xs text-gray-500">
            <span><kbd class="px-1.5 py-0.5 bg-gray-700 rounded">↑↓</kbd> navigieren</span>
            <span><kbd class="px-1.5 py-0.5 bg-gray-700 rounded">↵</kbd> auswählen</span>
            <span><kbd class="px-1.5 py-0.5 bg-gray-700 rounded">esc</kbd> schließen</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
