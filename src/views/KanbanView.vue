<template>
  <div class="h-full flex flex-col bg-gray-900 text-white">
    <!-- Header -->
    <header class="bg-gray-800/50 border-b border-gray-700 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between flex-shrink-0">
      <div class="flex items-center gap-2 sm:gap-3">
        <span class="text-xl sm:text-2xl">📋</span>
        <h1 class="text-base sm:text-xl font-bold">Kanban Board</h1>
      </div>
      <button @click="showAddTask = true" class="bg-rose-500 hover:bg-rose-600 px-3 sm:px-4 py-2 rounded-lg font-medium text-sm sm:text-base min-h-[44px] transition-colors">
        <span class="hidden sm:inline">+ Neue Aufgabe</span>
        <span class="sm:hidden">+ Neu</span>
      </button>
    </header>

    <!-- Board -->
    <div class="p-3 sm:p-6 flex gap-3 sm:gap-6 overflow-x-auto flex-1 snap-x snap-mandatory md:snap-none">
      <div
        v-for="column in columns"
        :key="column.id"
        class="flex-shrink-0 w-[75vw] sm:w-72 md:w-80 bg-gray-800 rounded-xl p-3 sm:p-4 snap-start"
        @dragover.prevent
        @drop="onDrop($event, column.id)"
      >
        <h2 class="font-bold text-base sm:text-lg mb-3 sm:mb-4 flex items-center gap-2">
          <span>{{ column.icon }}</span>
          <span>{{ column.title }}</span>
          <span class="ml-auto bg-gray-700 px-2 py-0.5 rounded text-xs sm:text-sm">
            {{ getTasksForColumn(column.id).length }}
          </span>
        </h2>

        <div class="space-y-2 sm:space-y-3">
          <div
            v-for="task in getTasksForColumn(column.id)"
            :key="task.id"
            draggable="true"
            @dragstart="onDragStart($event, task)"
            class="bg-gray-700 rounded-lg p-3 sm:p-4 cursor-move hover:bg-gray-600 transition-colors active:scale-[0.98]"
          >
            <h3 class="font-medium text-sm sm:text-base mb-1 sm:mb-2">{{ task.title }}</h3>
            <p v-if="task.description" class="text-gray-400 text-xs sm:text-sm mb-2 sm:mb-3 line-clamp-2">{{ task.description }}</p>
            <div class="flex items-center justify-between">
              <span v-if="task.priority" :class="priorityClass(task.priority)" class="text-xs px-2 py-1 rounded">
                {{ task.priority }}
              </span>
              <button @click="deleteTask(task.id)" class="text-gray-500 hover:text-red-400 text-sm min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 -mb-2">
                🗑️
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Task Modal -->
    <div v-if="showAddTask" class="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div class="bg-gray-800 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg sm:text-xl font-bold mb-4">Neue Aufgabe</h2>
        <form @submit.prevent="addTask">
          <div class="mb-4">
            <label class="block text-sm font-medium mb-2">Titel</label>
            <input v-model="newTask.title" type="text" required
              class="w-full bg-gray-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none text-sm sm:text-base" />
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium mb-2">Beschreibung</label>
            <textarea v-model="newTask.description" rows="3"
              class="w-full bg-gray-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none text-sm sm:text-base"></textarea>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium mb-2">Priorität</label>
            <select v-model="newTask.priority"
              class="w-full bg-gray-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none text-sm sm:text-base">
              <option value="">Keine</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div class="flex gap-3">
            <button type="button" @click="showAddTask = false"
              class="flex-1 bg-gray-700 hover:bg-gray-600 py-3 rounded-lg text-sm sm:text-base min-h-[44px] transition-colors">
              Abbrechen
            </button>
            <button type="submit" class="flex-1 bg-rose-500 hover:bg-rose-600 py-3 rounded-lg font-medium text-sm sm:text-base min-h-[44px] transition-colors">
              Erstellen
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { io, Socket } from 'socket.io-client'
import { api } from '../api'
import { useAuthStore } from '../stores/auth'

interface Task {
  id: string
  title: string
  description?: string
  column: string
  priority?: 'low' | 'medium' | 'high'
  createdAt: string
}

const authStore = useAuthStore()
let socket: Socket | null = null

const columns = [
  { id: 'backlog', title: 'Backlog', icon: '📥' },
  { id: 'todo', title: 'To Do', icon: '📋' },
  { id: 'progress', title: 'In Progress', icon: '🔄' },
  { id: 'done', title: 'Done', icon: '✅' }
]

const tasks = ref<Task[]>([])
const showAddTask = ref(false)
const newTask = ref({ title: '', description: '', priority: '' })
const draggedTask = ref<Task | null>(null)

const getTasksForColumn = (columnId: string) => {
  return tasks.value.filter(t => t.column === columnId)
}

const priorityClass = (priority: string) => {
  switch (priority) {
    case 'high': return 'bg-red-500/20 text-red-400'
    case 'medium': return 'bg-yellow-500/20 text-yellow-400'
    case 'low': return 'bg-green-500/20 text-green-400'
    default: return 'bg-gray-600'
  }
}

const loadTasks = async () => {
  try {
    const data = await api.get('/api/kanban/tasks')
    tasks.value = data.tasks || []
  } catch (e) {
    console.error('Failed to load tasks:', e)
  }
}

const addTask = async () => {
  if (!newTask.value.title.trim()) return
  try {
    const data = await api.post('/api/kanban/tasks', {
      title: newTask.value.title,
      description: newTask.value.description,
      priority: newTask.value.priority || undefined,
      column: 'backlog'
    })
    tasks.value.push(data.task)
    newTask.value = { title: '', description: '', priority: '' }
    showAddTask.value = false
  } catch (e) {
    console.error('Failed to add task:', e)
  }
}

const deleteTask = async (id: string) => {
  try {
    await api.delete(`/api/kanban/tasks/${id}`)
    tasks.value = tasks.value.filter(t => t.id !== id)
  } catch (e) {
    console.error('Failed to delete task:', e)
  }
}

const onDragStart = (event: DragEvent, task: Task) => {
  draggedTask.value = task
  event.dataTransfer!.effectAllowed = 'move'
}

const onDrop = async (_event: DragEvent, columnId: string) => {
  if (!draggedTask.value) return
  try {
    await api.patch(`/api/kanban/tasks/${draggedTask.value.id}`, { column: columnId })
    const task = tasks.value.find(t => t.id === draggedTask.value!.id)
    if (task) task.column = columnId
  } catch (e) {
    console.error('Failed to move task:', e)
  }
  draggedTask.value = null
}

const connectSocket = () => {
  const apiUrl = import.meta.env.VITE_API_URL || ''
  socket = io(apiUrl, {
    auth: { token: authStore.token }
  })

  socket.on('connect', () => {
    console.log('🔌 Kanban WebSocket connected')
  })

  socket.on('kanban:task:created', ({ task }: { task: Task }) => {
    // Only add if not already in list (avoid duplicate from own action)
    if (!tasks.value.find(t => t.id === task.id)) {
      tasks.value.push(task)
    }
  })

  socket.on('kanban:task:updated', ({ task }: { task: Task }) => {
    const idx = tasks.value.findIndex(t => t.id === task.id)
    if (idx !== -1) {
      tasks.value[idx] = task
    }
  })

  socket.on('kanban:task:deleted', ({ id }: { id: string }) => {
    tasks.value = tasks.value.filter(t => t.id !== id)
  })

  socket.on('disconnect', () => {
    console.log('🔌 Kanban WebSocket disconnected')
  })
}

onMounted(() => {
  loadTasks()
  connectSocket()
})

onUnmounted(() => {
  if (socket) {
    socket.disconnect()
    socket = null
  }
})
</script>
