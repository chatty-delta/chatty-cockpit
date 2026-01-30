<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { api } from '@/api'

interface PasswordEntry {
  id: string
  name: string
  username: string
  url?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

interface PasswordEntryWithPassword extends PasswordEntry {
  password: string
}

// Vault state
const isSetup = ref(false)
const isUnlocked = ref(false)
const loading = ref(true)
const entries = ref<PasswordEntry[]>([])

// Master password state
const masterPassword = ref('')
const masterPasswordConfirm = ref('')
const masterPasswordError = ref('')
const unlocking = ref(false)

// Selected entry
const selectedEntry = ref<PasswordEntryWithPassword | null>(null)
const loadingEntry = ref(false)
const showPassword = ref(false)

// Edit/Add modal
const showModal = ref(false)
const editMode = ref(false)
const editEntry = ref({
  id: '',
  name: '',
  username: '',
  password: '',
  url: '',
  notes: ''
})
const saving = ref(false)

// Password generator
const showGenerator = ref(false)
const generatedPassword = ref('')
const genLength = ref(20)
const genSymbols = ref(true)
const genNumbers = ref(true)
const genUppercase = ref(true)
const generating = ref(false)

// Search
const searchQuery = ref('')

// Toast
const toast = ref<{ message: string; type: 'success' | 'error' } | null>(null)
let toastTimeout: ReturnType<typeof setTimeout> | null = null

// Auto-lock timer
let autoLockTimer: ReturnType<typeof setTimeout> | null = null
let lastActivity = Date.now()
const AUTO_LOCK_MINUTES = 5

// Mobile view state
const showEntryDetail = ref(false)

// Computed
const filteredEntries = computed(() => {
  if (!searchQuery.value.trim()) return entries.value
  const q = searchQuery.value.toLowerCase()
  return entries.value.filter(e =>
    e.name.toLowerCase().includes(q) ||
    e.username.toLowerCase().includes(q) ||
    e.url?.toLowerCase().includes(q)
  )
})

// Toast helper
function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.value = { message, type }
  if (toastTimeout) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toast.value = null
  }, 3000)
}

// Activity tracking for auto-lock
function resetActivityTimer() {
  lastActivity = Date.now()
}

function checkAutoLock() {
  if (!isUnlocked.value) return
  if (Date.now() - lastActivity > AUTO_LOCK_MINUTES * 60 * 1000) {
    lockVault()
    showToast('Vault automatisch gesperrt', 'success')
  }
}

// API calls
async function checkVaultStatus() {
  loading.value = true
  try {
    const data = await api.get<{ isSetup: boolean; isUnlocked: boolean }>('/api/passwords/status')
    isSetup.value = data.isSetup
    isUnlocked.value = data.isUnlocked
    if (isUnlocked.value) {
      await fetchEntries()
    }
  } catch (e) {
    console.error('Failed to check vault status:', e)
  } finally {
    loading.value = false
  }
}

async function setupVault() {
  masterPasswordError.value = ''

  if (masterPassword.value.length < 8) {
    masterPasswordError.value = 'Mindestens 8 Zeichen erforderlich'
    return
  }

  if (masterPassword.value !== masterPasswordConfirm.value) {
    masterPasswordError.value = 'Passwörter stimmen nicht überein'
    return
  }

  unlocking.value = true
  try {
    await api.post('/api/passwords/setup', { masterPassword: masterPassword.value })
    isSetup.value = true
    isUnlocked.value = true
    masterPassword.value = ''
    masterPasswordConfirm.value = ''
    await fetchEntries()
    showToast('Vault erfolgreich eingerichtet')
  } catch (e: any) {
    masterPasswordError.value = e?.message || 'Fehler beim Einrichten'
  } finally {
    unlocking.value = false
  }
}

async function unlockVault() {
  masterPasswordError.value = ''

  if (!masterPassword.value) {
    masterPasswordError.value = 'Master-Passwort erforderlich'
    return
  }

  unlocking.value = true
  try {
    await api.post('/api/passwords/unlock', { masterPassword: masterPassword.value })
    isUnlocked.value = true
    masterPassword.value = ''
    await fetchEntries()
    showToast('Vault entsperrt')
  } catch (e: any) {
    masterPasswordError.value = 'Falsches Master-Passwort'
  } finally {
    unlocking.value = false
  }
}

async function lockVault() {
  try {
    await api.post('/api/passwords/lock', {})
  } catch (e) {
    console.error('Failed to lock vault:', e)
  }
  isUnlocked.value = false
  entries.value = []
  selectedEntry.value = null
  showEntryDetail.value = false
}

async function fetchEntries() {
  try {
    const data = await api.get<{ entries: PasswordEntry[] }>('/api/passwords')
    entries.value = data.entries || []
  } catch (e: any) {
    if (e?.message?.includes('401')) {
      isUnlocked.value = false
    }
    console.error('Failed to fetch entries:', e)
  }
}

async function fetchEntry(id: string) {
  loadingEntry.value = true
  showPassword.value = false
  try {
    const data = await api.get<{ entry: PasswordEntryWithPassword }>(`/api/passwords/${id}`)
    selectedEntry.value = data.entry
    showEntryDetail.value = true
  } catch (e: any) {
    if (e?.message?.includes('401')) {
      isUnlocked.value = false
    }
    console.error('Failed to fetch entry:', e)
  } finally {
    loadingEntry.value = false
  }
}

async function saveEntry() {
  if (!editEntry.value.name || !editEntry.value.password) {
    showToast('Name und Passwort erforderlich', 'error')
    return
  }

  saving.value = true
  try {
    if (editMode.value && editEntry.value.id) {
      await api.put(`/api/passwords/${editEntry.value.id}`, {
        name: editEntry.value.name,
        username: editEntry.value.username,
        password: editEntry.value.password,
        url: editEntry.value.url,
        notes: editEntry.value.notes
      })
      showToast('Eintrag aktualisiert')
    } else {
      await api.post('/api/passwords', {
        name: editEntry.value.name,
        username: editEntry.value.username,
        password: editEntry.value.password,
        url: editEntry.value.url,
        notes: editEntry.value.notes
      })
      showToast('Eintrag erstellt')
    }
    await fetchEntries()
    closeModal()
    if (editMode.value && selectedEntry.value?.id === editEntry.value.id) {
      await fetchEntry(editEntry.value.id)
    }
  } catch (e: any) {
    showToast(e?.message || 'Fehler beim Speichern', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteEntry(id: string) {
  if (!confirm('Eintrag wirklich löschen?')) return

  try {
    await api.delete(`/api/passwords/${id}`)
    entries.value = entries.value.filter(e => e.id !== id)
    if (selectedEntry.value?.id === id) {
      selectedEntry.value = null
      showEntryDetail.value = false
    }
    showToast('Eintrag gelöscht')
  } catch (e: any) {
    showToast(e?.message || 'Fehler beim Löschen', 'error')
  }
}

async function generatePassword() {
  generating.value = true
  try {
    const data = await api.post<{ password: string }>('/api/passwords/generate', {
      length: genLength.value,
      includeSymbols: genSymbols.value,
      includeNumbers: genNumbers.value,
      includeUppercase: genUppercase.value
    })
    generatedPassword.value = data.password
  } catch (e: any) {
    showToast(e?.message || 'Fehler beim Generieren', 'error')
  } finally {
    generating.value = false
  }
}

// Copy to clipboard
async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`${label} kopiert`)
  } catch (e) {
    showToast('Kopieren fehlgeschlagen', 'error')
  }
}

// Modal helpers
function openAddModal() {
  editMode.value = false
  editEntry.value = {
    id: '',
    name: '',
    username: '',
    password: '',
    url: '',
    notes: ''
  }
  generatedPassword.value = ''
  showModal.value = true
}

function openEditModal(entry: PasswordEntryWithPassword) {
  editMode.value = true
  editEntry.value = {
    id: entry.id,
    name: entry.name,
    username: entry.username,
    password: entry.password,
    url: entry.url || '',
    notes: entry.notes || ''
  }
  generatedPassword.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  showGenerator.value = false
}

function useGeneratedPassword() {
  editEntry.value.password = generatedPassword.value
  showGenerator.value = false
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  } catch {
    return dateStr
  }
}

// Event listeners
function handleActivity() {
  resetActivityTimer()
}

onMounted(() => {
  checkVaultStatus()

  // Activity listeners
  document.addEventListener('mousemove', handleActivity)
  document.addEventListener('keydown', handleActivity)
  document.addEventListener('click', handleActivity)

  // Auto-lock check every minute
  autoLockTimer = setInterval(checkAutoLock, 60000)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleActivity)
  document.removeEventListener('keydown', handleActivity)
  document.removeEventListener('click', handleActivity)

  if (autoLockTimer) clearInterval(autoLockTimer)
  if (toastTimeout) clearTimeout(toastTimeout)
})

// Reset activity on interaction
watch([searchQuery, showModal, selectedEntry], () => {
  resetActivityTimer()
})
</script>

<template>
  <div class="h-full flex flex-col bg-gray-900 text-white">
    <!-- Toast -->
    <Transition
      enter-active-class="duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="toast"
        :class="[
          'fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg',
          toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        ]"
      >
        {{ toast.message }}
      </div>
    </Transition>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="text-gray-400">Lade...</div>
    </div>

    <!-- Setup Screen -->
    <div v-else-if="!isSetup" class="flex-1 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <div class="text-6xl mb-4">🔐</div>
          <h1 class="text-2xl font-bold mb-2">Passwort-Manager einrichten</h1>
          <p class="text-gray-400">Erstelle ein Master-Passwort um deinen Tresor zu schützen.</p>
        </div>

        <form @submit.prevent="setupVault" class="space-y-4">
          <div>
            <label class="text-sm text-gray-400">Master-Passwort</label>
            <input
              v-model="masterPassword"
              type="password"
              class="mt-1 w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="Mindestens 8 Zeichen"
              autocomplete="new-password"
            />
          </div>

          <div>
            <label class="text-sm text-gray-400">Master-Passwort bestätigen</label>
            <input
              v-model="masterPasswordConfirm"
              type="password"
              class="mt-1 w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="Passwort wiederholen"
              autocomplete="new-password"
            />
          </div>

          <div v-if="masterPasswordError" class="text-red-400 text-sm">
            {{ masterPasswordError }}
          </div>

          <button
            type="submit"
            :disabled="unlocking"
            class="w-full py-3 rounded-lg bg-rose-500 hover:bg-rose-600 disabled:opacity-50 font-medium"
          >
            {{ unlocking ? 'Wird eingerichtet...' : 'Tresor erstellen' }}
          </button>
        </form>

        <p class="mt-6 text-center text-sm text-gray-500">
          Merke dir dieses Passwort gut - es kann nicht wiederhergestellt werden!
        </p>
      </div>
    </div>

    <!-- Unlock Screen -->
    <div v-else-if="!isUnlocked" class="flex-1 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <div class="text-6xl mb-4">🔒</div>
          <h1 class="text-2xl font-bold mb-2">Tresor entsperren</h1>
          <p class="text-gray-400">Gib dein Master-Passwort ein.</p>
        </div>

        <form @submit.prevent="unlockVault" class="space-y-4">
          <div>
            <input
              v-model="masterPassword"
              type="password"
              class="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="Master-Passwort"
              autocomplete="current-password"
              autofocus
            />
          </div>

          <div v-if="masterPasswordError" class="text-red-400 text-sm">
            {{ masterPasswordError }}
          </div>

          <button
            type="submit"
            :disabled="unlocking"
            class="w-full py-3 rounded-lg bg-rose-500 hover:bg-rose-600 disabled:opacity-50 font-medium"
          >
            {{ unlocking ? 'Entsperre...' : 'Entsperren' }}
          </button>
        </form>
      </div>
    </div>

    <!-- Main Password Manager UI -->
    <template v-else>
      <!-- Header -->
      <header class="p-4 border-b border-gray-700 flex items-center gap-3 flex-wrap">
        <button
          v-if="showEntryDetail"
          @click="showEntryDetail = false; selectedEntry = null"
          class="md:hidden px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
        >
          &larr; Zurück
        </button>
        <h1 class="text-lg font-semibold">🔐 Passwörter</h1>
        <span class="text-sm text-gray-400">{{ entries.length }} Einträge</span>
        <div class="ml-auto flex items-center gap-2">
          <button
            @click="openAddModal"
            class="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-sm font-medium"
          >
            + Neu
          </button>
          <button
            @click="lockVault"
            class="px-3 py-2 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-sm"
            title="Tresor sperren"
          >
            🔒
          </button>
        </div>
      </header>

      <!-- Main Content -->
      <div class="flex-1 flex overflow-hidden">
        <!-- Entry List -->
        <div
          :class="showEntryDetail ? 'hidden md:flex' : 'flex'"
          class="w-full md:w-80 flex-shrink-0 flex-col border-r border-gray-700"
        >
          <!-- Search -->
          <div class="p-2 border-b border-gray-700">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Suchen..."
              class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:border-rose-500"
            />
          </div>

          <!-- Entries -->
          <div class="flex-1 overflow-y-auto">
            <div v-if="filteredEntries.length === 0" class="p-4 text-gray-500 text-sm text-center">
              {{ searchQuery ? 'Keine Treffer' : 'Noch keine Passwörter gespeichert' }}
            </div>
            <div v-else>
              <button
                v-for="entry in filteredEntries"
                :key="entry.id"
                @click="fetchEntry(entry.id)"
                :class="[
                  'w-full p-3 border-b border-gray-700/50 text-left transition-colors',
                  selectedEntry?.id === entry.id
                    ? 'bg-gray-700/60'
                    : 'hover:bg-gray-800/50'
                ]"
              >
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center text-lg flex-shrink-0">
                    {{ entry.name[0]?.toUpperCase() || '?' }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="font-medium truncate">{{ entry.name }}</div>
                    <div class="text-sm text-gray-400 truncate">{{ entry.username || 'Kein Benutzername' }}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        <!-- Entry Detail -->
        <div
          :class="showEntryDetail ? 'flex' : 'hidden md:flex'"
          class="flex-1 flex-col bg-gray-900"
        >
          <!-- Empty State -->
          <div v-if="!selectedEntry" class="flex-1 flex items-center justify-center">
            <div class="text-center text-gray-500">
              <div class="text-4xl mb-2">🔑</div>
              <div>Wähle einen Eintrag aus</div>
            </div>
          </div>

          <!-- Entry Detail View -->
          <div v-else class="flex-1 flex flex-col overflow-hidden">
            <!-- Entry Header -->
            <div class="p-4 border-b border-gray-700">
              <div class="flex items-start gap-4">
                <div class="w-14 h-14 rounded-xl bg-gray-700 flex items-center justify-center text-2xl flex-shrink-0">
                  {{ selectedEntry.name[0]?.toUpperCase() || '?' }}
                </div>
                <div class="flex-1 min-w-0">
                  <h2 class="text-xl font-semibold truncate">{{ selectedEntry.name }}</h2>
                  <div v-if="selectedEntry.url" class="text-sm text-gray-400 truncate mt-1">
                    <a :href="selectedEntry.url" target="_blank" rel="noopener" class="hover:text-rose-400">
                      {{ selectedEntry.url }}
                    </a>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    @click="openEditModal(selectedEntry)"
                    class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                    title="Bearbeiten"
                  >
                    ✏️
                  </button>
                  <button
                    @click="deleteEntry(selectedEntry.id)"
                    class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-red-600 text-sm"
                    title="Löschen"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>

            <!-- Entry Fields -->
            <div class="flex-1 overflow-y-auto p-4 space-y-4">
              <div v-if="loadingEntry" class="text-gray-400">Lade...</div>
              <template v-else>
                <!-- Username -->
                <div class="bg-gray-800/50 rounded-lg p-3">
                  <div class="text-xs text-gray-400 mb-1">Benutzername</div>
                  <div class="flex items-center gap-2">
                    <span class="flex-1 font-mono">{{ selectedEntry.username || '-' }}</span>
                    <button
                      v-if="selectedEntry.username"
                      @click="copyToClipboard(selectedEntry.username, 'Benutzername')"
                      class="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm"
                    >
                      📋
                    </button>
                  </div>
                </div>

                <!-- Password -->
                <div class="bg-gray-800/50 rounded-lg p-3">
                  <div class="text-xs text-gray-400 mb-1">Passwort</div>
                  <div class="flex items-center gap-2">
                    <span class="flex-1 font-mono">
                      {{ showPassword ? selectedEntry.password : '••••••••••••' }}
                    </span>
                    <button
                      @click="showPassword = !showPassword"
                      class="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm"
                      :title="showPassword ? 'Verbergen' : 'Anzeigen'"
                    >
                      {{ showPassword ? '👁️' : '👁️‍🗨️' }}
                    </button>
                    <button
                      @click="copyToClipboard(selectedEntry.password, 'Passwort')"
                      class="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm"
                    >
                      📋
                    </button>
                  </div>
                </div>

                <!-- URL -->
                <div v-if="selectedEntry.url" class="bg-gray-800/50 rounded-lg p-3">
                  <div class="text-xs text-gray-400 mb-1">URL</div>
                  <div class="flex items-center gap-2">
                    <a
                      :href="selectedEntry.url"
                      target="_blank"
                      rel="noopener"
                      class="flex-1 text-rose-400 hover:text-rose-300 truncate"
                    >
                      {{ selectedEntry.url }}
                    </a>
                    <button
                      @click="copyToClipboard(selectedEntry.url!, 'URL')"
                      class="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm"
                    >
                      📋
                    </button>
                  </div>
                </div>

                <!-- Notes -->
                <div v-if="selectedEntry.notes" class="bg-gray-800/50 rounded-lg p-3">
                  <div class="text-xs text-gray-400 mb-1">Notizen</div>
                  <div class="whitespace-pre-wrap text-gray-200">{{ selectedEntry.notes }}</div>
                </div>

                <!-- Metadata -->
                <div class="text-xs text-gray-500 pt-4 space-y-1">
                  <div>Erstellt: {{ formatDate(selectedEntry.createdAt) }}</div>
                  <div>Aktualisiert: {{ formatDate(selectedEntry.updatedAt) }}</div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Add/Edit Modal -->
    <div v-if="showModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div class="w-full max-w-lg rounded-2xl bg-gray-900 border border-gray-700 shadow-xl flex flex-col max-h-[90vh]">
        <div class="p-4 border-b border-gray-700 flex items-center">
          <div class="font-semibold">{{ editMode ? 'Eintrag bearbeiten' : 'Neuer Eintrag' }}</div>
          <button
            class="ml-auto text-gray-400 hover:text-white"
            @click="closeModal"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label class="text-xs text-gray-400">Name *</label>
            <input
              v-model="editEntry.name"
              type="text"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="z.B. GitHub, Netflix"
            />
          </div>

          <div>
            <label class="text-xs text-gray-400">Benutzername</label>
            <input
              v-model="editEntry.username"
              type="text"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="E-Mail oder Benutzername"
            />
          </div>

          <div>
            <label class="text-xs text-gray-400">Passwort *</label>
            <div class="mt-1 flex gap-2">
              <input
                v-model="editEntry.password"
                type="text"
                class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500 font-mono"
                placeholder="Passwort"
              />
              <button
                @click="showGenerator = !showGenerator"
                class="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                title="Passwort generieren"
              >
                🎲
              </button>
            </div>
          </div>

          <!-- Password Generator -->
          <div v-if="showGenerator" class="bg-gray-800/50 rounded-lg p-3 space-y-3">
            <div class="text-sm font-medium">Passwort generieren</div>

            <div class="flex items-center gap-3">
              <label class="text-xs text-gray-400">Länge: {{ genLength }}</label>
              <input
                v-model.number="genLength"
                type="range"
                min="8"
                max="64"
                class="flex-1"
              />
            </div>

            <div class="flex flex-wrap gap-3">
              <label class="flex items-center gap-2 text-sm">
                <input v-model="genUppercase" type="checkbox" class="rounded" />
                Großbuchstaben
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input v-model="genNumbers" type="checkbox" class="rounded" />
                Zahlen
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input v-model="genSymbols" type="checkbox" class="rounded" />
                Symbole
              </label>
            </div>

            <div class="flex gap-2">
              <button
                @click="generatePassword"
                :disabled="generating"
                class="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
              >
                {{ generating ? '...' : 'Generieren' }}
              </button>
              <input
                v-model="generatedPassword"
                type="text"
                readonly
                class="flex-1 px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-sm font-mono"
                placeholder="Generiertes Passwort"
              />
              <button
                v-if="generatedPassword"
                @click="useGeneratedPassword"
                class="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-sm"
              >
                Verwenden
              </button>
            </div>
          </div>

          <div>
            <label class="text-xs text-gray-400">URL</label>
            <input
              v-model="editEntry.url"
              type="url"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="https://..."
            />
          </div>

          <div>
            <label class="text-xs text-gray-400">Notizen</label>
            <textarea
              v-model="editEntry.notes"
              rows="3"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500 resize-none"
              placeholder="Zusätzliche Infos..."
            />
          </div>
        </div>

        <div class="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
          <button
            @click="closeModal"
            class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
            :disabled="saving"
          >
            Abbrechen
          </button>
          <button
            @click="saveEntry"
            class="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-sm font-medium"
            :disabled="saving"
          >
            {{ saving ? 'Speichern...' : 'Speichern' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
