<template>
  <div class="h-full flex flex-col bg-gray-900 text-white">
    <!-- Header -->
    <header class="bg-gray-800/50 border-b border-gray-700 px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 sm:gap-3">
          <span class="text-xl sm:text-2xl">📂</span>
          <h1 class="text-base sm:text-xl font-bold">Projekte</h1>
          <span class="text-xs sm:text-sm text-gray-500">{{ projects.length }} Projekte</span>
        </div>
        <button
          @click="loadProjects"
          :disabled="loading"
          class="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-3 sm:px-4 py-2 rounded-lg font-medium text-sm sm:text-base min-h-[44px] transition-colors flex items-center gap-2"
        >
          <span :class="{ 'animate-spin': loading }">🔄</span>
          <span class="hidden sm:inline">Aktualisieren</span>
        </button>
      </div>
    </header>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4 md:p-6">
      <!-- Loading -->
      <div v-if="loading && projects.length === 0" class="flex items-center justify-center h-full text-gray-500">
        <div class="text-center">
          <span class="text-4xl block mb-3 animate-pulse">📂</span>
          <p>Projekte werden geladen...</p>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="projects.length === 0" class="flex items-center justify-center h-full text-gray-500">
        <div class="text-center">
          <span class="text-4xl block mb-3">📂</span>
          <p>Keine Projekte in ~/projects/ gefunden</p>
        </div>
      </div>

      <!-- Projects Grid -->
      <div v-else class="grid gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="project in projects"
          :key="project.name"
          class="bg-gray-800/50 rounded-xl p-4 sm:p-5 border border-gray-700 hover:border-gray-600 transition-colors"
        >
          <!-- Header -->
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="flex-1 min-w-0">
              <h2 class="font-bold text-base sm:text-lg truncate">{{ project.name }}</h2>
              <div v-if="project.packageJson" class="text-xs text-gray-500 mt-0.5 truncate">
                {{ project.packageJson.name }}@{{ project.packageJson.version }}
              </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <!-- Git Status Badge -->
              <span
                v-if="project.git"
                :class="[
                  'px-2 py-1 rounded text-xs font-medium',
                  project.git.hasChanges
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-green-500/20 text-green-400'
                ]"
              >
                {{ project.git.branch }}
              </span>
              <span v-else class="px-2 py-1 rounded text-xs bg-gray-700 text-gray-400">
                kein git
              </span>
            </div>
          </div>

          <!-- Git Info -->
          <div v-if="project.git" class="space-y-2 text-sm">
            <!-- Uncommitted Changes -->
            <div v-if="project.git.hasChanges" class="flex items-center gap-2 text-yellow-400">
              <span>⚠️</span>
              <span>{{ project.git.changedFiles }} ungespeicherte Änderungen</span>
            </div>

            <!-- Last Commit -->
            <div v-if="project.git.lastCommit" class="text-gray-400">
              <div class="flex items-center gap-2">
                <span>📝</span>
                <span class="truncate flex-1">{{ project.git.lastCommit.message }}</span>
              </div>
              <div class="text-xs text-gray-500 mt-1 ml-6">
                {{ formatDate(project.git.lastCommit.date) }}
              </div>
            </div>
          </div>

          <!-- Package.json Description -->
          <div v-if="project.packageJson?.description" class="text-sm text-gray-400 mt-3 line-clamp-2">
            {{ project.packageJson.description }}
          </div>

          <!-- Actions -->
          <div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-700">
            <button
              @click="openTerminal(project.name)"
              class="flex-1 min-w-[100px] bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span>💻</span>
              <span>Terminal</span>
            </button>
            <button
              v-if="project.git"
              @click="gitPull(project.name)"
              :disabled="pullingProject === project.name"
              class="flex-1 min-w-[100px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span :class="{ 'animate-spin': pullingProject === project.name }">⬇️</span>
              <span>{{ pullingProject === project.name ? 'Pulling...' : 'Git Pull' }}</span>
            </button>
            <button
              @click="openFolder(project.name)"
              class="flex-1 min-w-[100px] bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span>📁</span>
              <span>Öffnen</span>
            </button>
          </div>

          <!-- Pull Result -->
          <div
            v-if="pullResults[project.name]"
            :class="[
              'mt-3 p-3 rounded-lg text-xs font-mono whitespace-pre-wrap max-h-32 overflow-auto',
              pullResults[project.name].success ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
            ]"
          >
            {{ pullResults[project.name].message }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api'

interface GitInfo {
  branch: string
  hasChanges: boolean
  changedFiles: number
  lastCommit?: {
    hash: string
    message: string
    date: string
    author: string
  }
}

interface PackageJson {
  name: string
  version: string
  description?: string
}

interface Project {
  name: string
  path: string
  git?: GitInfo
  packageJson?: PackageJson
}

const projects = ref<Project[]>([])
const loading = ref(false)
const pullingProject = ref<string | null>(null)
const pullResults = ref<Record<string, { success: boolean; message: string }>>({})

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)

  if (hours < 1) return 'gerade eben'
  if (hours < 24) return `vor ${hours}h`
  if (days < 7) return `vor ${days} Tag${days > 1 ? 'en' : ''}`

  return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}

async function loadProjects() {
  loading.value = true
  pullResults.value = {}
  try {
    const data = await api.get<{ projects: Project[] }>('/api/projects')
    projects.value = data.projects || []
  } catch (e) {
    console.error('Failed to load projects:', e)
  } finally {
    loading.value = false
  }
}

async function gitPull(projectName: string) {
  pullingProject.value = projectName
  delete pullResults.value[projectName]

  try {
    const data = await api.post<{ success: boolean; output: string }>(`/api/projects/${encodeURIComponent(projectName)}/pull`)
    pullResults.value[projectName] = {
      success: data.success,
      message: data.output || 'Pull erfolgreich'
    }
    // Reload projects to update git status
    await loadProjects()
  } catch (e: any) {
    pullResults.value[projectName] = {
      success: false,
      message: e.message || 'Pull fehlgeschlagen'
    }
  } finally {
    pullingProject.value = null
  }
}

function openTerminal(projectName: string) {
  // Copy path to clipboard and show notification
  const projectPath = `~/projects/${projectName}`
  navigator.clipboard.writeText(`cd ${projectPath}`)
  alert(`Pfad kopiert: cd ${projectPath}\n\nFüge es in dein Terminal ein.`)
}

function openFolder(projectName: string) {
  // Open in file manager (works on most systems)
  const projectPath = `/home/ubuntu/projects/${projectName}`
  navigator.clipboard.writeText(projectPath)
  alert(`Pfad kopiert: ${projectPath}`)
}

onMounted(() => {
  loadProjects()
})
</script>
