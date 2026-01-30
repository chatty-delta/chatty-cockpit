<template>
  <div class="h-full flex flex-col bg-gray-900 text-white">
    <!-- Header -->
    <header class="bg-gray-800/50 border-b border-gray-700 px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 sm:gap-3">
          <span class="text-xl sm:text-2xl">📝</span>
          <h1 class="text-base sm:text-xl font-bold">Notizen</h1>
          <span class="text-xs sm:text-sm text-gray-500">{{ filteredNotes.length }} Einträge</span>
        </div>
        <button
          @click="createNote"
          class="bg-rose-500 hover:bg-rose-600 px-3 sm:px-4 py-2 rounded-lg font-medium text-sm sm:text-base min-h-[44px] transition-colors"
        >
          <span class="hidden sm:inline">+ Neue Notiz</span>
          <span class="sm:hidden">+ Neu</span>
        </button>
      </div>

      <!-- Search -->
      <div class="mt-3">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Notizen durchsuchen..."
          class="w-full bg-gray-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-rose-500 outline-none placeholder-gray-500"
        />
      </div>
    </header>

    <!-- Content -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Notes List -->
      <aside
        :class="[
          'flex-shrink-0 border-r border-gray-700 bg-gray-800/30 overflow-y-auto transition-all duration-200',
          selectedNote && !showListOnMobile ? 'hidden md:block' : 'block',
          'w-full md:w-72 lg:w-80'
        ]"
      >
        <div v-if="loading" class="p-4 text-center text-gray-500">
          Laden...
        </div>
        <div v-else-if="filteredNotes.length === 0" class="p-4 text-center text-gray-500">
          {{ searchQuery ? 'Keine Treffer' : 'Noch keine Notizen' }}
        </div>
        <div v-else class="divide-y divide-gray-700/50">
          <button
            v-for="note in filteredNotes"
            :key="note.id"
            @click="selectNote(note)"
            :class="[
              'w-full text-left p-4 hover:bg-gray-700/50 transition-colors',
              selectedNote?.id === note.id ? 'bg-gray-700/70' : ''
            ]"
          >
            <h3 class="font-medium text-sm sm:text-base line-clamp-1">
              {{ note.title || 'Unbenannt' }}
            </h3>
            <p class="text-gray-400 text-xs sm:text-sm mt-1 line-clamp-2">
              {{ getPreview(note.content) }}
            </p>
            <div class="flex items-center gap-2 mt-2 text-xs text-gray-500">
              <span>{{ formatDate(note.updatedAt) }}</span>
            </div>
          </button>
        </div>
      </aside>

      <!-- Note Editor -->
      <div
        :class="[
          'flex-1 flex flex-col overflow-hidden',
          !selectedNote && !isCreating ? 'hidden md:flex' : 'flex'
        ]"
      >
        <!-- Empty State -->
        <div
          v-if="!selectedNote && !isCreating"
          class="flex-1 flex items-center justify-center text-gray-500"
        >
          <div class="text-center">
            <span class="text-4xl block mb-3">📝</span>
            <p>Wähle eine Notiz aus oder erstelle eine neue</p>
          </div>
        </div>

        <!-- Editor -->
        <template v-else>
          <!-- Editor Header -->
          <div class="bg-gray-800/30 border-b border-gray-700 px-4 py-3 flex items-center gap-3">
            <button
              @click="closeEditor"
              class="md:hidden text-gray-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
            >
              ← Zurück
            </button>
            <input
              v-model="editTitle"
              type="text"
              placeholder="Titel..."
              class="flex-1 bg-transparent text-lg font-medium outline-none placeholder-gray-500"
              @input="markDirty"
            />
            <div class="flex items-center gap-2">
              <button
                v-if="isDirty"
                @click="saveNote"
                :disabled="saving"
                class="bg-rose-500 hover:bg-rose-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-sm font-medium min-h-[36px] transition-colors"
              >
                {{ saving ? 'Speichern...' : 'Speichern' }}
              </button>
              <button
                v-if="selectedNote"
                @click="confirmDelete"
                class="text-gray-400 hover:text-red-400 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
                title="Löschen"
              >
                🗑️
              </button>
            </div>
          </div>

          <!-- WYSIWYG Editor -->
          <div class="flex-1 overflow-y-auto p-4">
            <WysiwygEditor
              v-model="editContent"
              placeholder="Schreibe deine Notiz..."
              @update:modelValue="markDirty"
            />
          </div>

          <!-- Footer Info -->
          <div v-if="selectedNote" class="bg-gray-800/30 border-t border-gray-700 px-4 py-2 text-xs text-gray-500 flex-shrink-0">
            <span>Erstellt: {{ formatDate(selectedNote.createdAt) }}</span>
            <span class="mx-2">•</span>
            <span>Aktualisiert: {{ formatDate(selectedNote.updatedAt) }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div
      v-if="showDeleteConfirm"
      class="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
    >
      <div class="bg-gray-800 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 w-full sm:max-w-sm">
        <h2 class="text-lg font-bold mb-3">Notiz löschen?</h2>
        <p class="text-gray-400 text-sm mb-4">
          Diese Aktion kann nicht rückgängig gemacht werden.
        </p>
        <div class="flex gap-3">
          <button
            @click="showDeleteConfirm = false"
            class="flex-1 bg-gray-700 hover:bg-gray-600 py-3 rounded-lg text-sm min-h-[44px] transition-colors"
          >
            Abbrechen
          </button>
          <button
            @click="deleteNote"
            class="flex-1 bg-red-500 hover:bg-red-600 py-3 rounded-lg font-medium text-sm min-h-[44px] transition-colors"
          >
            Löschen
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '@/api'
import WysiwygEditor from '@/components/WysiwygEditor.vue'

interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

const notes = ref<Note[]>([])
const selectedNote = ref<Note | null>(null)
const isCreating = ref(false)
const loading = ref(true)
const saving = ref(false)
const isDirty = ref(false)
const searchQuery = ref('')
const showListOnMobile = ref(true)
const showDeleteConfirm = ref(false)

const editTitle = ref('')
const editContent = ref('')

// Sorted and filtered notes
const filteredNotes = computed(() => {
  let result = [...notes.value]

  // Filter by search
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(n =>
      n.title.toLowerCase().includes(q) ||
      stripHtml(n.content).toLowerCase().includes(q)
    )
  }

  // Sort by date (newest first)
  result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return result
})

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function getPreview(content: string): string {
  const text = stripHtml(content)
  return text.slice(0, 100) || 'Keine Vorschau'
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // Today
  if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  // This year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
  }

  return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function loadNotes() {
  loading.value = true
  try {
    const data = await api.get('/api/notes')
    notes.value = data.notes || []
  } catch (e) {
    console.error('Failed to load notes:', e)
  } finally {
    loading.value = false
  }
}

function createNote() {
  selectedNote.value = null
  isCreating.value = true
  editTitle.value = ''
  editContent.value = ''
  isDirty.value = false
  showListOnMobile.value = false
}

function selectNote(note: Note) {
  if (isDirty.value && !confirm('Ungespeicherte Änderungen verwerfen?')) {
    return
  }
  selectedNote.value = note
  isCreating.value = false
  editTitle.value = note.title
  editContent.value = note.content
  isDirty.value = false
  showListOnMobile.value = false
}

function closeEditor() {
  if (isDirty.value && !confirm('Ungespeicherte Änderungen verwerfen?')) {
    return
  }
  selectedNote.value = null
  isCreating.value = false
  isDirty.value = false
  showListOnMobile.value = true
}

function markDirty() {
  isDirty.value = true
}

async function saveNote() {
  if (saving.value) return

  saving.value = true
  try {
    if (isCreating.value) {
      // Create new note
      const data = await api.post('/api/notes', {
        title: editTitle.value || 'Unbenannt',
        content: editContent.value
      })
      notes.value.unshift(data.note)
      selectedNote.value = data.note
      isCreating.value = false
    } else if (selectedNote.value) {
      // Update existing note
      const data = await api.put(`/api/notes/${selectedNote.value.id}`, {
        title: editTitle.value,
        content: editContent.value
      })
      const idx = notes.value.findIndex(n => n.id === selectedNote.value!.id)
      if (idx !== -1) {
        notes.value[idx] = data.note
      }
      selectedNote.value = data.note
    }
    isDirty.value = false
  } catch (e) {
    console.error('Failed to save note:', e)
    alert('Speichern fehlgeschlagen')
  } finally {
    saving.value = false
  }
}

function confirmDelete() {
  showDeleteConfirm.value = true
}

async function deleteNote() {
  if (!selectedNote.value) return

  try {
    await api.delete(`/api/notes/${selectedNote.value.id}`)
    notes.value = notes.value.filter(n => n.id !== selectedNote.value!.id)
    selectedNote.value = null
    isCreating.value = false
    isDirty.value = false
    showListOnMobile.value = true
  } catch (e) {
    console.error('Failed to delete note:', e)
    alert('Löschen fehlgeschlagen')
  } finally {
    showDeleteConfirm.value = false
  }
}

// Auto-save on Ctrl+S
function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && isDirty.value) {
    e.preventDefault()
    saveNote()
  }
}

onMounted(() => {
  loadNotes()
  document.addEventListener('keydown', handleKeydown)
})

// Cleanup
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>
