<template>
  <div class="h-full flex flex-col bg-gray-900 text-white">
    <!-- Header -->
    <header class="bg-gray-800/50 border-b border-gray-700 px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-0 sm:justify-between flex-shrink-0">
      <div class="flex items-center gap-2 sm:gap-3">
        <span class="text-xl sm:text-2xl">📅</span>
        <h1 class="text-base sm:text-xl font-bold">Kalender</h1>
      </div>
      <div class="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-center">
        <button @click="goToday" class="bg-gray-700 hover:bg-gray-600 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors min-h-[40px]">
          Heute
        </button>
        <div class="flex items-center gap-1 sm:gap-2">
          <button @click="prevMonth" class="bg-gray-700 hover:bg-gray-600 w-9 h-9 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center transition-colors min-w-[40px] min-h-[40px]">
            ◀
          </button>
          <span class="text-sm sm:text-lg font-semibold min-w-[140px] sm:min-w-[180px] text-center">{{ monthLabel }}</span>
          <button @click="nextMonth" class="bg-gray-700 hover:bg-gray-600 w-9 h-9 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center transition-colors min-w-[40px] min-h-[40px]">
            ▶
          </button>
        </div>
        <button @click="openCreateModal()" class="bg-rose-500 hover:bg-rose-600 px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors text-xs sm:text-base min-h-[40px] whitespace-nowrap">
          <span class="hidden sm:inline">+ Neues Event</span>
          <span class="sm:hidden">+ Neu</span>
        </button>
      </div>
    </header>

    <!-- Calendar Grid -->
    <div class="flex-1 p-2 sm:p-6 overflow-auto">
      <!-- Weekday Headers -->
      <div class="grid grid-cols-7 gap-0.5 sm:gap-1 mb-0.5 sm:mb-1">
        <div v-for="(day, i) in weekDays" :key="day" class="text-center text-[10px] sm:text-sm font-medium text-gray-400 py-1 sm:py-2">
          <span class="sm:hidden">{{ weekDaysShort[i] }}</span>
          <span class="hidden sm:inline">{{ day }}</span>
        </div>
      </div>

      <!-- Day Cells -->
      <div class="grid grid-cols-7 gap-0.5 sm:gap-1 h-[calc(100%-32px)] sm:h-[calc(100%-40px)]" :style="{ gridTemplateRows: `repeat(${weekRows}, 1fr)` }">
        <div
          v-for="(cell, idx) in calendarCells"
          :key="idx"
          @click="selectDay(cell)"
          :class="[
            'rounded sm:rounded-lg p-1 sm:p-2 cursor-pointer transition-colors min-h-[48px] sm:min-h-[80px] flex flex-col',
            cell.isCurrentMonth ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-800/30 text-gray-600',
            cell.isToday ? 'ring-2 ring-rose-500 bg-gray-700' : '',
            selectedDate === cell.dateStr ? 'ring-2 ring-rose-400' : ''
          ]"
        >
          <span :class="[
            'text-[11px] sm:text-sm font-medium mb-0.5 sm:mb-1',
            cell.isToday ? 'text-rose-400 font-bold' : ''
          ]">{{ cell.day }}</span>
          <div class="flex flex-wrap gap-0.5 sm:gap-1 mt-auto">
            <span
              v-for="event in getEventsForDate(cell.dateStr).slice(0, mobileView ? 2 : 3)"
              :key="event.id"
              :class="categoryDotClass(event.category)"
              class="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0"
              :title="event.title"
            ></span>
            <span v-if="getEventsForDate(cell.dateStr).length > (mobileView ? 2 : 3)" class="text-[9px] sm:text-xs text-gray-400">
              +{{ getEventsForDate(cell.dateStr).length - (mobileView ? 2 : 3) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Day Detail Panel -->
    <Transition name="slide">
      <div v-if="selectedDate"
        :class="[
          'fixed bg-gray-800 border-gray-700 shadow-2xl z-40 flex flex-col',
          'inset-0 md:inset-y-0 md:left-auto md:right-0 md:w-96 md:border-l'
        ]"
      >
        <div class="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 class="text-base sm:text-lg font-bold">{{ selectedDateLabel }}</h2>
          <button @click="selectedDate = null" class="text-gray-400 hover:text-white text-xl min-w-[44px] min-h-[44px] flex items-center justify-center">✕</button>
        </div>
        <div class="flex-1 overflow-auto p-4 space-y-3">
          <div v-if="selectedDayEvents.length === 0" class="text-gray-500 text-sm text-center py-8">
            Keine Events an diesem Tag
          </div>
          <div
            v-for="event in selectedDayEvents"
            :key="event.id"
            class="bg-gray-700 rounded-lg p-3 sm:p-4 space-y-2"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span :class="categoryDotClass(event.category)" class="w-3 h-3 rounded-full flex-shrink-0"></span>
                <h3 class="font-semibold text-sm sm:text-base truncate">{{ event.title }}</h3>
              </div>
              <div class="flex gap-1 flex-shrink-0">
                <button @click="openEditModal(event)" class="text-gray-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center" title="Bearbeiten">✏️</button>
                <button @click="deleteEvent(event.id)" class="text-gray-400 hover:text-red-400 min-w-[44px] min-h-[44px] flex items-center justify-center" title="Löschen">🗑️</button>
              </div>
            </div>
            <div class="text-sm text-gray-400">
              <span>{{ formatTime(event.start) }}</span>
              <span v-if="event.end"> – {{ formatTime(event.end) }}</span>
            </div>
            <p v-if="event.description" class="text-sm text-gray-300">{{ event.description }}</p>
            <span class="inline-block text-xs px-2 py-0.5 rounded" :class="categoryBadgeClass(event.category)">
              {{ categoryLabel(event.category) }}
            </span>
          </div>
        </div>
        <div class="p-4 border-t border-gray-700">
          <button @click="openCreateModal(selectedDate)" class="w-full bg-rose-500 hover:bg-rose-600 py-3 rounded-lg font-medium transition-colors min-h-[44px]">
            + Event hinzufügen
          </button>
        </div>
      </div>
    </Transition>

    <!-- Create/Edit Modal -->
    <div v-if="showModal" class="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div class="bg-gray-800 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 w-full sm:max-w-md max-h-[90vh] overflow-y-auto" @click.stop>
        <h2 class="text-lg sm:text-xl font-bold mb-4">{{ editingEvent ? 'Event bearbeiten' : 'Neues Event' }}</h2>
        <form @submit.prevent="saveEvent">
          <!-- Title -->
          <div class="mb-4">
            <label class="block text-sm font-medium mb-2">Titel *</label>
            <input
              v-model="form.title"
              type="text"
              required
              placeholder="Event-Titel"
              class="w-full bg-gray-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none text-sm sm:text-base"
            />
          </div>
          <!-- Start -->
          <div class="mb-4 grid grid-cols-2 gap-2 sm:gap-3">
            <div>
              <label class="block text-sm font-medium mb-2">Startdatum *</label>
              <input
                v-model="form.startDate"
                type="date"
                required
                class="w-full bg-gray-700 rounded-lg px-3 sm:px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none [color-scheme:dark] text-sm sm:text-base"
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">Startzeit</label>
              <input
                v-model="form.startTime"
                type="time"
                class="w-full bg-gray-700 rounded-lg px-3 sm:px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none [color-scheme:dark] text-sm sm:text-base"
              />
            </div>
          </div>
          <!-- End -->
          <div class="mb-4 grid grid-cols-2 gap-2 sm:gap-3">
            <div>
              <label class="block text-sm font-medium mb-2">Enddatum</label>
              <input
                v-model="form.endDate"
                type="date"
                class="w-full bg-gray-700 rounded-lg px-3 sm:px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none [color-scheme:dark] text-sm sm:text-base"
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">Endzeit</label>
              <input
                v-model="form.endTime"
                type="time"
                class="w-full bg-gray-700 rounded-lg px-3 sm:px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none [color-scheme:dark] text-sm sm:text-base"
              />
            </div>
          </div>
          <!-- Description -->
          <div class="mb-4">
            <label class="block text-sm font-medium mb-2">Beschreibung</label>
            <textarea
              v-model="form.description"
              rows="3"
              placeholder="Optional..."
              class="w-full bg-gray-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none text-sm sm:text-base"
            ></textarea>
          </div>
          <!-- Category -->
          <div class="mb-6">
            <label class="block text-sm font-medium mb-2">Kategorie</label>
            <div class="flex gap-2 flex-wrap">
              <button
                v-for="cat in categories"
                :key="cat.value"
                type="button"
                @click="form.category = cat.value"
                :class="[
                  'px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors min-h-[40px]',
                  form.category === cat.value
                    ? cat.activeClass
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                ]"
              >
                {{ cat.label }}
              </button>
            </div>
          </div>
          <!-- Actions -->
          <div class="flex gap-3">
            <button type="button" @click="closeModal" class="flex-1 bg-gray-700 hover:bg-gray-600 py-3 rounded-lg transition-colors min-h-[44px] text-sm sm:text-base">
              Abbrechen
            </button>
            <button type="submit" class="flex-1 bg-rose-500 hover:bg-rose-600 py-3 rounded-lg font-medium transition-colors min-h-[44px] text-sm sm:text-base">
              {{ editingEvent ? 'Speichern' : 'Erstellen' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue'
import { api } from '../api'

// Types
interface CalendarEvent {
  id: string
  title: string
  start: string
  end?: string
  description?: string
  category?: string
  createdBy: string
  createdAt: string
}

interface CalendarCell {
  day: number
  dateStr: string
  isCurrentMonth: boolean
  isToday: boolean
}

// State
const currentYear = ref(new Date().getFullYear())
const currentMonth = ref(new Date().getMonth()) // 0-indexed
const events = ref<CalendarEvent[]>([])
const selectedDate = ref<string | null>(null)
const showModal = ref(false)
const editingEvent = ref<CalendarEvent | null>(null)
const mobileView = ref(false)

const form = ref({
  title: '',
  startDate: '',
  startTime: '09:00',
  endDate: '',
  endTime: '',
  description: '',
  category: 'work'
})

const weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const weekDaysShort = ['M', 'D', 'M', 'D', 'F', 'S', 'S']

const categories = [
  { value: 'work', label: '💼 Arbeit', activeClass: 'bg-blue-500/30 text-blue-300 ring-1 ring-blue-500' },
  { value: 'personal', label: '🏠 Privat', activeClass: 'bg-green-500/30 text-green-300 ring-1 ring-green-500' },
  { value: 'meeting', label: '🤝 Meeting', activeClass: 'bg-purple-500/30 text-purple-300 ring-1 ring-purple-500' },
  { value: 'deadline', label: '🔥 Deadline', activeClass: 'bg-red-500/30 text-red-300 ring-1 ring-red-500' },
  { value: 'other', label: '📌 Sonstiges', activeClass: 'bg-yellow-500/30 text-yellow-300 ring-1 ring-yellow-500' },
]

// Responsive detection
function checkMobile() {
  mobileView.value = window.innerWidth < 640
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  loadEvents()
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})

// Computed
const monthLabel = computed(() => {
  const date = new Date(currentYear.value, currentMonth.value)
  return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
})

const todayStr = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

const calendarCells = computed<CalendarCell[]>(() => {
  const year = currentYear.value
  const month = currentMonth.value
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  // Monday = 0, Sunday = 6 (ISO style)
  let startWeekday = firstDay.getDay() - 1
  if (startWeekday < 0) startWeekday = 6

  const cells: CalendarCell[] = []

  // Previous month fill
  const prevLastDay = new Date(year, month, 0)
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = prevLastDay.getDate() - i
    const m = month === 0 ? 12 : month
    const y = month === 0 ? year - 1 : year
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, dateStr, isCurrentMonth: false, isToday: dateStr === todayStr.value })
  }

  // Current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, dateStr, isCurrentMonth: true, isToday: dateStr === todayStr.value })
  }

  // Next month fill
  const remaining = 7 - (cells.length % 7)
  if (remaining < 7) {
    const nextMonth = month + 2 > 12 ? 1 : month + 2
    const nextYear = month + 2 > 12 ? year + 1 : year
    for (let d = 1; d <= remaining; d++) {
      const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cells.push({ day: d, dateStr, isCurrentMonth: false, isToday: dateStr === todayStr.value })
    }
  }

  return cells
})

const weekRows = computed(() => Math.ceil(calendarCells.value.length / 7))

const selectedDayEvents = computed(() => {
  if (!selectedDate.value) return []
  return getEventsForDate(selectedDate.value).sort((a, b) => a.start.localeCompare(b.start))
})

const selectedDateLabel = computed(() => {
  if (!selectedDate.value) return ''
  const [y, m, d] = selectedDate.value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (mobileView.value) {
    return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }
  return date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
})

// Methods
function getEventsForDate(dateStr: string): CalendarEvent[] {
  return events.value.filter(e => {
    const eventDate = e.start.slice(0, 10)
    return eventDate === dateStr
  })
}

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value--
  } else {
    currentMonth.value--
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value++
  } else {
    currentMonth.value++
  }
}

function goToday() {
  const now = new Date()
  currentYear.value = now.getFullYear()
  currentMonth.value = now.getMonth()
  selectedDate.value = todayStr.value
}

function selectDay(cell: CalendarCell) {
  selectedDate.value = cell.dateStr
}

function openCreateModal(dateStr?: string | null) {
  editingEvent.value = null
  const d = dateStr || todayStr.value
  form.value = {
    title: '',
    startDate: d,
    startTime: '09:00',
    endDate: '',
    endTime: '',
    description: '',
    category: 'work'
  }
  showModal.value = true
}

function openEditModal(event: CalendarEvent) {
  editingEvent.value = event
  const startParts = event.start.split('T')
  const endParts = event.end ? event.end.split('T') : ['', '']
  form.value = {
    title: event.title,
    startDate: startParts[0] || '',
    startTime: startParts[1]?.slice(0, 5) || '09:00',
    endDate: endParts[0] || '',
    endTime: endParts[1]?.slice(0, 5) || '',
    description: event.description || '',
    category: event.category || 'work'
  }
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingEvent.value = null
}

async function saveEvent() {
  if (!form.value.title.trim()) return

  const start = form.value.startTime
    ? `${form.value.startDate}T${form.value.startTime}:00`
    : `${form.value.startDate}T00:00:00`

  const end = form.value.endDate
    ? (form.value.endTime ? `${form.value.endDate}T${form.value.endTime}:00` : `${form.value.endDate}T23:59:00`)
    : undefined

  const payload: any = {
    title: form.value.title.trim(),
    start,
    end,
    description: form.value.description.trim() || undefined,
    category: form.value.category
  }

  try {
    if (editingEvent.value) {
      const { event } = await api.patch(`/api/calendar/events/${editingEvent.value.id}`, payload)
      const idx = events.value.findIndex(e => e.id === editingEvent.value!.id)
      if (idx !== -1) events.value[idx] = event
    } else {
      const { event } = await api.post('/api/calendar/events', payload)
      events.value.push(event)
    }
    closeModal()
  } catch (e) {
    console.error('Failed to save event:', e)
  }
}

async function deleteEvent(id: string) {
  try {
    await api.delete(`/api/calendar/events/${id}`)
    events.value = events.value.filter(e => e.id !== id)
  } catch (e) {
    console.error('Failed to delete event:', e)
  }
}

async function loadEvents() {
  try {
    const monthStr = `${currentYear.value}-${String(currentMonth.value + 1).padStart(2, '0')}`
    const data = await api.get(`/api/calendar/events?month=${monthStr}`)
    events.value = data.events || []
  } catch (e) {
    console.error('Failed to load events:', e)
  }
}

function formatTime(dt: string) {
  if (!dt) return ''
  const timePart = dt.split('T')[1]
  if (!timePart) return ''
  return timePart.slice(0, 5)
}

function categoryDotClass(category?: string) {
  switch (category) {
    case 'work': return 'bg-blue-400'
    case 'personal': return 'bg-green-400'
    case 'meeting': return 'bg-purple-400'
    case 'deadline': return 'bg-red-400'
    case 'other': return 'bg-yellow-400'
    default: return 'bg-gray-400'
  }
}

function categoryBadgeClass(category?: string) {
  switch (category) {
    case 'work': return 'bg-blue-500/20 text-blue-300'
    case 'personal': return 'bg-green-500/20 text-green-300'
    case 'meeting': return 'bg-purple-500/20 text-purple-300'
    case 'deadline': return 'bg-red-500/20 text-red-300'
    case 'other': return 'bg-yellow-500/20 text-yellow-300'
    default: return 'bg-gray-600 text-gray-300'
  }
}

function categoryLabel(category?: string) {
  const cat = categories.find(c => c.value === category)
  return cat ? cat.label : '📌 Sonstiges'
}

// Watch month changes -> reload events
watch([currentYear, currentMonth], () => {
  loadEvents()
})
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
@media (max-width: 767px) {
  .slide-enter-from,
  .slide-leave-to {
    transform: translateY(100%);
  }
}
</style>
