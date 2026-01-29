<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'

type FileItem = {
  name: string
  type: 'file' | 'folder'
  size: number
  mtime: number
}

const currentPath = ref('') // relative to user root
const items = ref<FileItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const uploadProgress = ref<string | null>(null)

// Internal drag state
const draggingItem = ref<FileItem | null>(null)
const dropTargetFolder = ref<string | null>(null)

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  const crumbs: { label: string; path: string }[] = [{ label: 'Files', path: '' }]
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p
    crumbs.push({ label: p, path: acc })
  }
  return crumbs
})

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const fixed = i === 0 ? 0 : n < 10 ? 1 : 0
  return `${n.toFixed(fixed)} ${units[i]}`
}

function formatTime(ms: number) {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return ''
  }
}

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const q = currentPath.value ? `?path=${encodeURIComponent(currentPath.value)}` : ''
    const data = await api.get<{ items: FileItem[] }>(`/api/files/list${q}`)
    items.value = data.items
  } catch (e: any) {
    error.value = e?.message || 'Failed to load files'
  } finally {
    loading.value = false
  }
}

function openFolder(name: string) {
  currentPath.value = currentPath.value ? `${currentPath.value}/${name}` : name
  refresh()
}

function goUp() {
  const parts = currentPath.value.split('/').filter(Boolean)
  parts.pop()
  currentPath.value = parts.join('/')
  refresh()
}

function goToPath(p: string) {
  currentPath.value = p
  refresh()
}

function fullPath(name: string) {
  return currentPath.value ? `${currentPath.value}/${name}` : name
}

async function createFolder() {
  const name = prompt('Folder name')?.trim()
  if (!name) return
  try {
    await api.post('/api/files/folder', { path: currentPath.value, name })
    await refresh()
  } catch (e: any) {
    alert(e?.message || 'Failed to create folder')
  }
}

function triggerUpload() {
  fileInput.value?.click()
}

async function uploadFile(file: File) {
  const token = localStorage.getItem('token')
  const form = new FormData()
  form.append('file', file)

  const q = currentPath.value ? `?path=${encodeURIComponent(currentPath.value)}` : ''
  const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/files/upload${q}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(txt || `Upload failed (${res.status})`)
  }
}

async function onFileSelected(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  try {
    uploadProgress.value = `Uploading ${files.length} file(s)...`
    for (let i = 0; i < files.length; i++) {
      uploadProgress.value = `Uploading ${i + 1}/${files.length}: ${files[i].name}`
      await uploadFile(files[i])
    }
    await refresh()
  } catch (e: any) {
    alert(e?.message || 'Upload failed')
  } finally {
    input.value = ''
    uploadProgress.value = null
  }
}

// Drag and drop handlers (external files only)
function onDragEnter(e: DragEvent) {
  if (draggingItem.value) return // Ignore internal drags
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = true
}

function onDragOver(e: DragEvent) {
  if (draggingItem.value) return // Ignore internal drags
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = true
}

function onDragLeave(e: DragEvent) {
  if (draggingItem.value) return // Ignore internal drags
  e.preventDefault()
  e.stopPropagation()
  // Only set to false if we're leaving the drop zone entirely
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX
  const y = e.clientY
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    isDragging.value = false
  }
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = false
  
  // If it's an internal drag, ignore (handled by folder drop)
  if (draggingItem.value) return

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  try {
    uploadProgress.value = `Uploading ${files.length} file(s)...`
    for (let i = 0; i < files.length; i++) {
      uploadProgress.value = `Uploading ${i + 1}/${files.length}: ${files[i].name}`
      await uploadFile(files[i])
    }
    await refresh()
  } catch (err: any) {
    alert(err?.message || 'Upload failed')
  } finally {
    uploadProgress.value = null
  }
}

// Internal drag-drop for moving files/folders
function onItemDragStart(e: DragEvent, item: FileItem) {
  draggingItem.value = item
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', item.name)
}

function onItemDragEnd() {
  draggingItem.value = null
  dropTargetFolder.value = null
  isDragging.value = false // Clear just in case
}

function onFolderDragOver(e: DragEvent, folderName: string) {
  if (!draggingItem.value) return
  if (draggingItem.value.name === folderName) return // Can't drop on self
  e.preventDefault()
  e.stopPropagation()
  dropTargetFolder.value = folderName
}

function onFolderDragLeave(e: DragEvent) {
  e.preventDefault()
  dropTargetFolder.value = null
}

async function onFolderDrop(e: DragEvent, targetFolderName: string) {
  e.preventDefault()
  e.stopPropagation()
  
  if (!draggingItem.value) return
  if (draggingItem.value.name === targetFolderName) return

  const sourcePath = fullPath(draggingItem.value.name)
  const destFolder = fullPath(targetFolderName)

  try {
    await api.post('/api/files/move', { sourcePath, destFolder })
    await refresh()
  } catch (err: any) {
    alert(err?.message || 'Move failed')
  } finally {
    draggingItem.value = null
    dropTargetFolder.value = null
  }
}

// Drop on ".." (parent folder)
async function onParentDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  
  if (!draggingItem.value) return
  if (!currentPath.value) return // Already at root

  const sourcePath = fullPath(draggingItem.value.name)
  const parentParts = currentPath.value.split('/').filter(Boolean)
  parentParts.pop()
  const destFolder = parentParts.join('/')

  try {
    await api.post('/api/files/move', { sourcePath, destFolder })
    await refresh()
  } catch (err: any) {
    alert(err?.message || 'Move failed')
  } finally {
    draggingItem.value = null
    dropTargetFolder.value = null
  }
}

async function downloadItem(item: FileItem) {
  if (item.type !== 'file') return

  const rel = fullPath(item.name)
  const token = localStorage.getItem('token')
  const url = `${import.meta.env.VITE_API_URL || ''}/api/files/download?path=${encodeURIComponent(rel)}`

  const res = await fetch(url, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    alert(txt || `Download failed (${res.status})`)
    return
  }

  const blob = await res.blob()
  const a = document.createElement('a')
  const objectUrl = URL.createObjectURL(blob)
  a.href = objectUrl
  a.download = item.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

async function deleteItem(item: FileItem) {
  const rel = fullPath(item.name)
  const ok = confirm(`Delete ${item.type === 'folder' ? 'folder' : 'file'}: ${item.name}?`)
  if (!ok) return

  try {
    await api.delete(`/api/files/item?path=${encodeURIComponent(rel)}`)
    await refresh()
  } catch (e: any) {
    alert(e?.message || 'Delete failed')
  }
}

const sortedItems = computed(() => {
  return [...items.value].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
})

onMounted(refresh)
</script>

<template>
  <div 
    class="h-full flex flex-col relative"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Drag overlay (external files only) -->
    <div 
      v-if="isDragging && !draggingItem"
      class="absolute inset-0 z-50 bg-rose-500/20 border-4 border-dashed border-rose-500 rounded-lg flex items-center justify-center pointer-events-none"
    >
      <div class="text-center">
        <div class="text-5xl mb-3">📥</div>
        <p class="text-xl font-semibold text-rose-300">Dateien hier ablegen</p>
      </div>
    </div>

    <!-- Upload progress -->
    <div 
      v-if="uploadProgress"
      class="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg text-sm"
    >
      {{ uploadProgress }}
    </div>

    <header class="px-4 md:px-6 py-4 border-b border-gray-800">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <h1 class="text-lg font-semibold">📁 Files</h1>
          <div class="text-xs text-gray-400 mt-1 truncate">
            <button
              v-for="(c, idx) in breadcrumbs"
              :key="c.path || 'root'"
              class="hover:text-white"
              @click="goToPath(c.path)"
            >
              <span v-if="idx > 0" class="text-gray-600"> / </span>
              {{ c.label }}
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <input ref="fileInput" type="file" class="hidden" multiple @change="onFileSelected" />
          <button
            @click="triggerUpload"
            class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm"
          >
            Upload
          </button>
          <button
            @click="createFolder"
            class="px-3 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-sm"
          >
            New Folder
          </button>
        </div>
      </div>
    </header>

    <section class="flex-1 overflow-auto px-2 md:px-6 py-4">
      <div v-if="error" class="mb-3 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
        {{ error }}
      </div>

      <div v-if="loading" class="text-sm text-gray-400 px-2">Loading…</div>

      <div v-else class="space-y-2">
        <!-- Parent directory (..) -->
        <div
          v-if="currentPath"
          :class="[
            'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
            dropTargetFolder === '..' ? 'bg-rose-500/30 border-rose-500' : 'bg-gray-800/40 border-gray-700/50 hover:bg-gray-800/60'
          ]"
          @click="goUp"
          @dragover.prevent="if (draggingItem) { $event.stopPropagation(); dropTargetFolder = '..' }"
          @dragleave.prevent="dropTargetFolder = null"
          @drop="onParentDrop"
        >
          <span class="text-xl flex-shrink-0">📂</span>
          <span class="text-gray-300">..</span>
          <span v-if="draggingItem" class="ml-auto text-xs text-gray-500">Hierher verschieben</span>
        </div>
        
        <div
          v-for="item in sortedItems"
          :key="item.type + ':' + item.name"
          :class="[
            'flex items-center gap-3 p-3 rounded-xl border transition-colors',
            dropTargetFolder === item.name ? 'bg-rose-500/30 border-rose-500' : 'bg-gray-800/40 border-gray-700/50 hover:bg-gray-800/60',
            draggingItem?.name === item.name ? 'opacity-50' : ''
          ]"
          draggable="true"
          @dragstart="onItemDragStart($event, item)"
          @dragend="onItemDragEnd"
          @dragover="item.type === 'folder' ? onFolderDragOver($event, item.name) : null"
          @dragleave="onFolderDragLeave"
          @drop="item.type === 'folder' ? onFolderDrop($event, item.name) : null"
        >
          <button
            class="flex items-center gap-3 min-w-0 flex-1 text-left"
            @click="item.type === 'folder' ? openFolder(item.name) : downloadItem(item)"
            :title="item.type === 'folder' ? 'Open folder' : 'Download'"
          >
            <span class="text-xl flex-shrink-0">{{ item.type === 'folder' ? '📁' : '📄' }}</span>
            <div class="min-w-0">
              <div class="font-medium truncate">{{ item.name }}</div>
              <div class="text-xs text-gray-400">
                <span v-if="item.type === 'file'">{{ formatBytes(item.size) }}</span>
                <span v-if="item.type === 'file'" class="text-gray-600"> • </span>
                <span>{{ formatTime(item.mtime) }}</span>
              </div>
            </div>
          </button>

          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              v-if="item.type === 'file'"
              @click="downloadItem(item)"
              class="px-2.5 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700"
            >
              Download
            </button>
            <button
              @click="deleteItem(item)"
              class="px-2.5 py-1.5 rounded-lg text-xs bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300"
            >
              Delete
            </button>
          </div>
        </div>

        <div v-if="sortedItems.length === 0" class="text-sm text-gray-400 px-2">
          Empty folder.
        </div>
      </div>
    </section>
  </div>
</template>
