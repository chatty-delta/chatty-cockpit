<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRouter, useRoute } from 'vue-router'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRemindersStore } from '@/stores/reminders'
import CommandPalette from '@/components/CommandPalette.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useReminderNotifications } from '@/composables/useReminderNotifications'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const collapsed = ref(false)
const reminders = useRemindersStore()
const showCommandPalette = ref(false)
const { showHints, navShortcuts } = useKeyboardShortcuts()

// Enable reminder notifications
useReminderNotifications()

// Global Cmd+K shortcut
function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    showCommandPalette.value = !showCommandPalette.value
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

const navItems = [
  { path: '/dashboard', icon: '🏠', label: 'Dashboard' },
  { path: '/chat', icon: '💬', label: 'Chat' },
  { path: '/reminders', icon: '📌', label: 'Reminders', badge: () => reminders.openCount },
  { path: '/kanban', icon: '📋', label: 'Kanban' },
  { path: '/calendar', icon: '📅', label: 'Kalender' },
  { path: '/files', icon: '📁', label: 'Files' },
  { path: '/knowledge', icon: '📚', label: 'Wiki' },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
]

watch(() => auth.isAuthenticated, (v) => {
  if (v) reminders.fetchAll().catch(() => {})
}, { immediate: true })

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="h-screen flex flex-col md:flex-row bg-gray-900 text-white">
    <!-- Command Palette -->
    <CommandPalette :open="showCommandPalette" @close="showCommandPalette = false" />
    
    <!-- Keyboard Shortcut Hints -->
    <Transition
      enter-active-class="duration-150 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="duration-100 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div 
        v-if="showHints"
        class="fixed bottom-20 md:bottom-4 left-1/2 transform -translate-x-1/2 z-50 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 shadow-xl"
      >
        <div class="text-xs text-gray-400 mb-1">Gehe zu...</div>
        <div class="flex gap-3 text-sm">
          <span v-for="(path, key) in navShortcuts" :key="key" class="flex items-center gap-1">
            <kbd class="px-1.5 py-0.5 bg-gray-700 rounded text-xs">{{ key }}</kbd>
            <span class="text-gray-300">{{ path.slice(1) }}</span>
          </span>
        </div>
      </div>
    </Transition>
    <!-- Desktop Sidebar (hidden on mobile) -->
    <aside
      :class="collapsed ? 'w-16' : 'w-56'"
      class="hidden md:flex flex-col border-r border-gray-700 bg-gray-800/80 transition-all duration-200 flex-shrink-0"
    >
      <!-- Logo -->
      <div class="px-4 py-5 flex items-center gap-3 border-b border-gray-700">
        <span class="text-2xl flex-shrink-0">💬</span>
        <span v-if="!collapsed" class="font-bold text-lg tracking-tight">Chatty</span>
        <button
          @click="collapsed = !collapsed"
          class="ml-auto text-gray-400 hover:text-white text-sm flex-shrink-0"
          :title="collapsed ? 'Sidebar öffnen' : 'Sidebar einklappen'"
        >
          {{ collapsed ? '▶' : '◀' }}
        </button>
      </div>

      <!-- Search Button -->
      <div class="px-2 py-2">
        <button
          @click="showCommandPalette = true"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
        >
          <span class="text-lg">🔍</span>
          <span v-if="!collapsed" class="flex-1 text-left text-sm">Suchen...</span>
          <kbd v-if="!collapsed" class="text-xs px-1.5 py-0.5 bg-gray-600 rounded">⌘K</kbd>
        </button>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 py-3 space-y-1 px-2">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          :class="[
            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
            route.path === item.path
              ? 'bg-rose-500/20 text-rose-400'
              : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          ]"
          :title="item.label"
        >
          <span class="text-lg flex-shrink-0">{{ item.icon }}</span>
          <span v-if="!collapsed" class="text-sm font-medium flex items-center gap-2">
            {{ item.label }}
            <span
              v-if="(item as any).badge && (item as any).badge().value > 0"
              class="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300"
            >{{ (item as any).badge().value }}</span>
          </span>
        </router-link>
      </nav>

      <!-- User / Logout -->
      <div class="border-t border-gray-700 p-3">
        <div v-if="!collapsed" class="text-xs text-gray-500 mb-2 px-2 truncate">
          {{ auth.user?.email }}
        </div>
        <button
          @click="logout"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors w-full"
          title="Abmelden"
        >
          <span class="text-lg flex-shrink-0">🚪</span>
          <span v-if="!collapsed" class="text-sm">Abmelden</span>
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-hidden pb-16 md:pb-0">
      <router-view />
    </main>

    <!-- Mobile Bottom Navigation (visible only on mobile) -->
    <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-800 border-t border-gray-700 flex items-center justify-around px-2 safe-bottom">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        :class="[
          'flex flex-col items-center justify-center py-2 px-3 min-w-[56px] min-h-[56px] rounded-lg transition-colors',
          route.path === item.path
            ? 'text-rose-400'
            : 'text-gray-400 active:text-white'
        ]"
      >
        <span class="text-xl leading-none relative">
          {{ item.icon }}
          <span
            v-if="(item as any).badge && (item as any).badge().value > 0"
            class="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center"
          >{{ (item as any).badge().value }}</span>
        </span>
        <span class="text-[10px] mt-1 font-medium">{{ item.label }}</span>
      </router-link>
      <button
        @click="logout"
        class="flex flex-col items-center justify-center py-2 px-3 min-w-[56px] min-h-[56px] rounded-lg text-gray-400 active:text-white transition-colors"
      >
        <span class="text-xl leading-none">🚪</span>
        <span class="text-[10px] mt-1 font-medium">Logout</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.safe-bottom {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
