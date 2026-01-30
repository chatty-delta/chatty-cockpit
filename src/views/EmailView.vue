<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '@/api'

interface EmailFolder {
  name: string
  path: string
  unreadCount?: number
}

interface EmailMessage {
  id: string
  uid: number
  folder: string
  from: string
  fromName?: string
  to: string
  subject: string
  date: string
  preview: string
  body?: string
  bodyHtml?: string
  seen: boolean
  flags: string[]
}

// State
const folders = ref<EmailFolder[]>([])
const messages = ref<EmailMessage[]>([])
const selectedFolder = ref('INBOX')
const selectedMessage = ref<EmailMessage | null>(null)
const loadingFolders = ref(false)
const loadingMessages = ref(false)
const loadingMessage = ref(false)

// Compose state
const composeOpen = ref(false)
const composeTo = ref('')
const composeSubject = ref('')
const composeBody = ref('')
const replyToId = ref<string | null>(null)
const sending = ref(false)

// Search/filter
const searchQuery = ref('')

// Mobile view state
const showMessageDetail = ref(false)

// Computed
const filteredMessages = computed(() => {
  if (!searchQuery.value.trim()) return messages.value
  const q = searchQuery.value.toLowerCase()
  return messages.value.filter(m =>
    m.subject.toLowerCase().includes(q) ||
    m.from.toLowerCase().includes(q) ||
    (m.fromName?.toLowerCase().includes(q)) ||
    m.preview.toLowerCase().includes(q)
  )
})

const unreadCount = computed(() => {
  const inbox = folders.value.find(f => f.path === 'INBOX')
  return inbox?.unreadCount || 0
})

const folderIcon = (folder: EmailFolder) => {
  const name = folder.path.toLowerCase()
  if (name === 'inbox') return '📥'
  if (name.includes('sent')) return '📤'
  if (name.includes('draft')) return '📝'
  if (name.includes('trash') || name.includes('deleted') || name.includes('papierkorb')) return '🗑️'
  if (name.includes('spam') || name.includes('junk')) return '🚫'
  if (name.includes('archive')) return '📦'
  return '📁'
}

// API calls
async function fetchFolders() {
  loadingFolders.value = true
  try {
    const data = await api.get<{ folders: EmailFolder[] }>('/api/email/folders')
    folders.value = data.folders || []
  } catch (e) {
    console.error('Failed to fetch folders:', e)
  } finally {
    loadingFolders.value = false
  }
}

async function fetchMessages() {
  loadingMessages.value = true
  selectedMessage.value = null
  showMessageDetail.value = false
  try {
    const data = await api.get<{ messages: EmailMessage[]; total: number }>(
      `/api/email/messages?folder=${encodeURIComponent(selectedFolder.value)}&limit=50`
    )
    messages.value = data.messages || []
  } catch (e) {
    console.error('Failed to fetch messages:', e)
    messages.value = []
  } finally {
    loadingMessages.value = false
  }
}

async function fetchMessage(id: string) {
  loadingMessage.value = true
  try {
    const data = await api.get<{ message: EmailMessage }>(`/api/email/message/${encodeURIComponent(id)}`)
    selectedMessage.value = data.message

    // Update in list
    const idx = messages.value.findIndex(m => m.id === id)
    if (idx >= 0 && data.message) {
      messages.value[idx] = { ...messages.value[idx], ...data.message, seen: true }
    }

    // Mark as read
    if (data.message && !data.message.seen) {
      await api.post(`/api/email/mark-read/${encodeURIComponent(id)}`, {})
    }
  } catch (e) {
    console.error('Failed to fetch message:', e)
  } finally {
    loadingMessage.value = false
  }
}

async function deleteMessage(id: string) {
  if (!confirm('E-Mail löschen?')) return
  try {
    await api.delete(`/api/email/message/${encodeURIComponent(id)}`)
    messages.value = messages.value.filter(m => m.id !== id)
    if (selectedMessage.value?.id === id) {
      selectedMessage.value = null
      showMessageDetail.value = false
    }
    await fetchFolders() // Refresh unread counts
  } catch (e: any) {
    alert(e?.message || 'Fehler beim Löschen')
  }
}

async function toggleRead(msg: EmailMessage) {
  try {
    if (msg.seen) {
      await api.post(`/api/email/mark-unread/${encodeURIComponent(msg.id)}`, {})
    } else {
      await api.post(`/api/email/mark-read/${encodeURIComponent(msg.id)}`, {})
    }
    msg.seen = !msg.seen
    await fetchFolders()
  } catch (e: any) {
    alert(e?.message || 'Fehler')
  }
}

async function sendEmail() {
  if (!composeTo.value.trim() || !composeSubject.value.trim()) {
    alert('Empfänger und Betreff erforderlich')
    return
  }

  sending.value = true
  try {
    await api.post('/api/email/send', {
      to: composeTo.value.trim(),
      subject: composeSubject.value.trim(),
      body: composeBody.value,
      replyTo: replyToId.value || undefined
    })
    closeCompose()
    alert('E-Mail gesendet!')
  } catch (e: any) {
    alert(e?.message || 'Fehler beim Senden')
  } finally {
    sending.value = false
  }
}

function openCompose() {
  composeTo.value = ''
  composeSubject.value = ''
  composeBody.value = ''
  replyToId.value = null
  composeOpen.value = true
}

function openReply(msg: EmailMessage) {
  composeTo.value = msg.from
  composeSubject.value = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`
  composeBody.value = `\n\n--- Original Message ---\nFrom: ${msg.fromName || msg.from}\nDate: ${formatDate(msg.date)}\nSubject: ${msg.subject}\n\n${msg.body || msg.preview}`
  replyToId.value = msg.id
  composeOpen.value = true
}

function closeCompose() {
  composeOpen.value = false
  composeTo.value = ''
  composeSubject.value = ''
  composeBody.value = ''
  replyToId.value = null
}

function selectMessage(msg: EmailMessage) {
  fetchMessage(msg.id)
  showMessageDetail.value = true
}

function formatDate(dateStr: string) {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    }

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Gestern'
    }

    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  } catch {
    return dateStr
  }
}

function formatFullDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleString('de-DE')
  } catch {
    return dateStr
  }
}

// Watchers
watch(selectedFolder, () => {
  fetchMessages()
})

// Lifecycle
onMounted(async () => {
  await Promise.all([fetchFolders(), fetchMessages()])
})
</script>

<template>
  <div class="h-full flex flex-col bg-gray-900 text-white">
    <!-- Header -->
    <header class="p-4 border-b border-gray-700 flex items-center gap-3 flex-wrap">
      <button
        v-if="showMessageDetail"
        @click="showMessageDetail = false; selectedMessage = null"
        class="md:hidden px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
      >
        ← Zurück
      </button>
      <h1 class="text-lg font-semibold">📧 E-Mail</h1>
      <span v-if="unreadCount > 0" class="text-xs px-2 py-1 rounded-full bg-rose-500/20 text-rose-300">
        {{ unreadCount }} ungelesen
      </span>
      <div class="ml-auto flex items-center gap-2">
        <button
          @click="openCompose"
          class="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-sm font-medium"
        >
          + Neu
        </button>
        <button
          @click="fetchFolders(); fetchMessages()"
          class="px-3 py-2 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-sm"
          :disabled="loadingMessages"
        >
          {{ loadingMessages ? '...' : '🔄' }}
        </button>
      </div>
    </header>

    <!-- Main Content -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Folders Sidebar (hidden on mobile when message detail shown) -->
      <aside
        :class="showMessageDetail ? 'hidden md:flex' : 'flex'"
        class="w-full md:w-48 flex-shrink-0 flex-col border-r border-gray-700 bg-gray-800/50"
      >
        <div class="p-2 border-b border-gray-700">
          <div class="text-xs uppercase tracking-wider text-gray-400 px-2 py-1">Ordner</div>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-1">
          <div v-if="loadingFolders" class="text-gray-400 text-sm px-2">Lade...</div>
          <button
            v-else
            v-for="folder in folders"
            :key="folder.path"
            @click="selectedFolder = folder.path"
            :class="[
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors',
              selectedFolder === folder.path
                ? 'bg-rose-500/20 text-rose-400'
                : 'text-gray-300 hover:bg-gray-700/50'
            ]"
          >
            <span>{{ folderIcon(folder) }}</span>
            <span class="flex-1 truncate">{{ folder.name }}</span>
            <span
              v-if="folder.unreadCount && folder.unreadCount > 0"
              class="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500 text-white"
            >
              {{ folder.unreadCount }}
            </span>
          </button>
        </div>
      </aside>

      <!-- Message List (hidden on mobile when message detail shown) -->
      <div
        :class="showMessageDetail ? 'hidden md:flex' : 'flex'"
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

        <!-- Messages -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="loadingMessages" class="p-4 text-gray-400 text-sm">Lade E-Mails...</div>
          <div v-else-if="filteredMessages.length === 0" class="p-4 text-gray-500 text-sm">
            {{ searchQuery ? 'Keine Treffer' : 'Keine E-Mails' }}
          </div>
          <div v-else>
            <button
              v-for="msg in filteredMessages"
              :key="msg.id"
              @click="selectMessage(msg)"
              :class="[
                'w-full p-3 border-b border-gray-700/50 text-left transition-colors',
                selectedMessage?.id === msg.id
                  ? 'bg-gray-700/60'
                  : 'hover:bg-gray-800/50',
                !msg.seen && 'bg-gray-800/80'
              ]"
            >
              <div class="flex items-start gap-2">
                <div
                  v-if="!msg.seen"
                  class="w-2 h-2 rounded-full bg-rose-500 mt-2 flex-shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span :class="['text-sm truncate', !msg.seen && 'font-semibold']">
                      {{ msg.fromName || msg.from }}
                    </span>
                    <span class="text-[10px] text-gray-500 flex-shrink-0">
                      {{ formatDate(msg.date) }}
                    </span>
                  </div>
                  <div :class="['text-sm truncate mt-0.5', !msg.seen ? 'text-white' : 'text-gray-300']">
                    {{ msg.subject }}
                  </div>
                  <div class="text-xs text-gray-500 truncate mt-0.5">
                    {{ msg.preview }}
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Message Detail / Compose -->
      <div
        :class="showMessageDetail ? 'flex' : 'hidden md:flex'"
        class="flex-1 flex-col bg-gray-900"
      >
        <!-- Empty State -->
        <div v-if="!selectedMessage && !composeOpen" class="flex-1 flex items-center justify-center">
          <div class="text-center text-gray-500">
            <div class="text-4xl mb-2">📧</div>
            <div>Wähle eine E-Mail aus</div>
          </div>
        </div>

        <!-- Message Detail -->
        <div v-else-if="selectedMessage && !composeOpen" class="flex-1 flex flex-col overflow-hidden">
          <!-- Message Header -->
          <div class="p-4 border-b border-gray-700">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <h2 class="text-lg font-semibold">{{ selectedMessage.subject }}</h2>
                <div class="flex items-center gap-2 mt-2 text-sm">
                  <div class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-lg">
                    {{ (selectedMessage.fromName || selectedMessage.from)[0]?.toUpperCase() }}
                  </div>
                  <div>
                    <div class="font-medium">{{ selectedMessage.fromName || selectedMessage.from }}</div>
                    <div v-if="selectedMessage.fromName" class="text-gray-400 text-xs">
                      {{ selectedMessage.from }}
                    </div>
                  </div>
                </div>
                <div class="text-xs text-gray-500 mt-2">
                  {{ formatFullDate(selectedMessage.date) }}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="openReply(selectedMessage)"
                  class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                  title="Antworten"
                >
                  ↩️ Antworten
                </button>
                <button
                  @click="toggleRead(selectedMessage)"
                  class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                  :title="selectedMessage.seen ? 'Als ungelesen markieren' : 'Als gelesen markieren'"
                >
                  {{ selectedMessage.seen ? '📭' : '📬' }}
                </button>
                <button
                  @click="deleteMessage(selectedMessage.id)"
                  class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-red-600 text-sm"
                  title="Löschen"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>

          <!-- Message Body -->
          <div class="flex-1 overflow-y-auto p-4">
            <div v-if="loadingMessage" class="text-gray-400">Lade...</div>
            <div v-else-if="selectedMessage.bodyHtml" class="prose prose-invert max-w-none">
              <div
                v-html="selectedMessage.bodyHtml"
                class="email-body text-gray-200"
              />
            </div>
            <div v-else class="whitespace-pre-wrap text-gray-200">
              {{ selectedMessage.body || selectedMessage.preview }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Compose Modal -->
    <div v-if="composeOpen" class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div class="w-full max-w-2xl rounded-2xl bg-gray-900 border border-gray-700 shadow-xl flex flex-col max-h-[90vh]">
        <div class="p-4 border-b border-gray-700 flex items-center">
          <div class="font-semibold">{{ replyToId ? 'Antworten' : 'Neue E-Mail' }}</div>
          <button
            class="ml-auto text-gray-400 hover:text-white"
            @click="closeCompose"
            title="Schließen"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label class="text-xs text-gray-400">An</label>
            <input
              v-model="composeTo"
              type="email"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="email@example.com"
            />
          </div>

          <div>
            <label class="text-xs text-gray-400">Betreff</label>
            <input
              v-model="composeSubject"
              type="text"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500"
              placeholder="Betreff"
            />
          </div>

          <div>
            <label class="text-xs text-gray-400">Nachricht</label>
            <textarea
              v-model="composeBody"
              rows="12"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-rose-500 resize-none"
              placeholder="Deine Nachricht..."
            />
          </div>
        </div>

        <div class="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
          <button
            @click="closeCompose"
            class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
            :disabled="sending"
          >
            Abbrechen
          </button>
          <button
            @click="sendEmail"
            class="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-sm font-medium"
            :disabled="sending"
          >
            {{ sending ? 'Sende...' : '📤 Senden' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.email-body {
  word-break: break-word;
}

.email-body :deep(a) {
  color: #f27a8a;
  text-decoration: underline;
}

.email-body :deep(img) {
  max-width: 100%;
  height: auto;
}

.email-body :deep(table) {
  border-collapse: collapse;
  max-width: 100%;
}

.email-body :deep(blockquote) {
  border-left: 3px solid #4b5563;
  padding-left: 1rem;
  margin-left: 0;
  color: #9ca3af;
}
</style>
