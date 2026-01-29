<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import WysiwygEditor from '@/components/WysiwygEditor.vue'

interface Article {
  id: string
  title: string
  content: string
  tags: string[]
  folder: string
  author: string
  createdAt: string
  updatedAt: string
}

interface FolderNode {
  name: string
  path: string
  articles: Article[]
  children: FolderNode[]
}

const articles = ref<Article[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const searchQuery = ref('')
const selectedTags = ref<string[]>([])
const currentFolder = ref('')
const expandedFolders = ref<Set<string>>(new Set(['']))
const sidebarCollapsed = ref(false)

// Explicit empty folders (stored in localStorage)
const explicitFolders = ref<Set<string>>(new Set(
  JSON.parse(localStorage.getItem('wiki-folders') || '[]')
))

function saveExplicitFolders() {
  localStorage.setItem('wiki-folders', JSON.stringify([...explicitFolders.value]))
}

// Editor state
const isEditing = ref(false)
const editingArticle = ref<Article | null>(null)
const editorTitle = ref('')
const editorContent = ref('')
const editorTags = ref('')
const editorFolder = ref('')

// View state
const viewingArticle = ref<Article | null>(null)

// Get all unique tags
const allTags = computed(() => {
  const tags = new Set<string>()
  articles.value.forEach(a => a.tags?.forEach(t => tags.add(t)))
  return Array.from(tags).sort()
})

// Get all unique folders (from articles + explicit empty folders)
const allFolders = computed(() => {
  const folders = new Set<string>()
  folders.add('') // root
  
  // From articles
  articles.value.forEach(a => {
    if (a.folder) {
      // Add folder and all parent folders
      const parts = a.folder.split('/')
      let path = ''
      parts.forEach(part => {
        path = path ? `${path}/${part}` : part
        folders.add(path)
      })
    }
  })
  
  // From explicit folders
  explicitFolders.value.forEach(f => {
    if (f) {
      const parts = f.split('/')
      let path = ''
      parts.forEach(part => {
        path = path ? `${path}/${part}` : part
        folders.add(path)
      })
    }
  })
  
  return Array.from(folders).sort()
})

// Build folder tree
const folderTree = computed((): FolderNode => {
  const root: FolderNode = { name: '📚 Wiki', path: '', articles: [], children: [] }
  const folderMap: Record<string, FolderNode> = { '': root }

  // Create all folder nodes
  allFolders.value.forEach(folderPath => {
    if (folderPath === '') return
    const parts = folderPath.split('/')
    let currentPath = ''
    let parentNode = root

    parts.forEach((part) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      if (!folderMap[currentPath]) {
        const node: FolderNode = { name: part, path: currentPath, articles: [], children: [] }
        folderMap[currentPath] = node
        parentNode.children.push(node)
      }
      parentNode = folderMap[currentPath]
    })
  })

  // Assign articles to folders
  articles.value.forEach(article => {
    const folder = article.folder || ''
    if (folderMap[folder]) {
      folderMap[folder].articles.push(article)
    }
  })

  // Sort children and articles alphabetically
  const sortNode = (node: FolderNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    node.articles.sort((a, b) => a.title.localeCompare(b.title))
    node.children.forEach(sortNode)
  }
  sortNode(root)

  return root
})

// Filter articles by search and tags (used in sidebar)
const filteredArticles = computed(() => {
  let list = [...articles.value]

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q) ||
      a.tags?.some(t => t.toLowerCase().includes(q))
    )
  }

  if (selectedTags.value.length > 0) {
    list = list.filter(a => selectedTags.value.every(tag => a.tags?.includes(tag)))
  }

  return list
})

// Check if article passes current filters
function articleMatchesFilter(article: Article): boolean {
  return filteredArticles.value.some(a => a.id === article.id)
}

// Check if folder has any matching articles (including subfolders)
function folderHasMatches(folderPath: string): boolean {
  // If no filters active, all folders are visible
  if (!searchQuery.value.trim() && selectedTags.value.length === 0) return true
  
  return filteredArticles.value.some(a => {
    if (!folderPath) return !a.folder // Root folder
    return a.folder === folderPath || a.folder.startsWith(folderPath + '/')
  })
}

function toggleFolder(path: string) {
  if (expandedFolders.value.has(path)) {
    expandedFolders.value.delete(path)
  } else {
    expandedFolders.value.add(path)
  }
  expandedFolders.value = new Set(expandedFolders.value)
}

function selectFolder(path: string) {
  currentFolder.value = path
  viewingArticle.value = null
  isEditing.value = false
}

function toggleTag(tag: string) {
  const idx = selectedTags.value.indexOf(tag)
  if (idx >= 0) {
    selectedTags.value.splice(idx, 1)
  } else {
    selectedTags.value.push(tag)
  }
}

async function fetchArticles() {
  loading.value = true
  error.value = null
  try {
    const data = await api.get<{ articles: Article[] }>('/api/knowledge')
    articles.value = data.articles.map(a => ({ ...a, folder: a.folder || '' }))
  } catch (e: any) {
    error.value = e?.message || 'Failed to load articles'
  } finally {
    loading.value = false
  }
}

function createFolder() {
  const name = prompt('Ordnername:')
  if (!name?.trim()) return
  
  const newPath = currentFolder.value ? `${currentFolder.value}/${name.trim()}` : name.trim()
  
  // Add to explicit folders and persist
  explicitFolders.value.add(newPath)
  explicitFolders.value = new Set(explicitFolders.value)
  saveExplicitFolders()
  
  // Navigate and expand
  currentFolder.value = newPath
  expandedFolders.value.add(newPath)
  // Also expand parent
  if (currentFolder.value) {
    const parentParts = currentFolder.value.split('/').slice(0, -1)
    let parentPath = ''
    parentParts.forEach(p => {
      parentPath = parentPath ? `${parentPath}/${p}` : p
      expandedFolders.value.add(parentPath)
    })
  }
  expandedFolders.value = new Set(expandedFolders.value)
}

async function deleteCurrentFolder() {
  if (!currentFolder.value) {
    alert('Root-Ordner kann nicht gelöscht werden')
    return
  }
  
  // Find all articles in this folder and subfolders
  const folderPath = currentFolder.value
  const articlesInFolder = articles.value.filter(a => 
    a.folder === folderPath || a.folder.startsWith(folderPath + '/')
  )
  
  if (articlesInFolder.length > 0) {
    const ok = confirm(`Ordner "${folderPath}" enthält ${articlesInFolder.length} Artikel.\n\nAlle löschen?`)
    if (!ok) return
    
    try {
      for (const article of articlesInFolder) {
        await api.delete(`/api/knowledge/${article.id}`)
      }
    } catch (e: any) {
      alert(e?.message || 'Fehler beim Löschen')
      return
    }
  }
  
  // Remove from explicit folders (this folder and all subfolders)
  const toRemove = [...explicitFolders.value].filter(f => f === folderPath || f.startsWith(folderPath + '/'))
  toRemove.forEach(f => explicitFolders.value.delete(f))
  saveExplicitFolders()
  
  // Navigate to parent
  const parts = currentFolder.value.split('/').filter(Boolean)
  parts.pop()
  currentFolder.value = parts.join('/')
  
  if (articlesInFolder.length > 0) {
    await fetchArticles()
  }
}

async function renameCurrentFolder() {
  if (!currentFolder.value) {
    alert('Root-Ordner kann nicht umbenannt werden')
    return
  }
  
  const oldPath = currentFolder.value
  const oldName = oldPath.split('/').pop() || ''
  const newName = prompt('Neuer Ordnername:', oldName)
  if (!newName?.trim() || newName.trim() === oldName) return
  
  const parentPath = oldPath.split('/').slice(0, -1).join('/')
  const newPath = parentPath ? `${parentPath}/${newName.trim()}` : newName.trim()
  
  // Update all articles in this folder and subfolders
  const articlesToUpdate = articles.value.filter(a => 
    a.folder === oldPath || a.folder.startsWith(oldPath + '/')
  )
  
  if (articlesToUpdate.length === 0) {
    // No articles, just navigate to new path
    currentFolder.value = newPath
    return
  }
  
  try {
    for (const article of articlesToUpdate) {
      const newFolder = article.folder === oldPath 
        ? newPath 
        : article.folder.replace(oldPath + '/', newPath + '/')
      await api.put(`/api/knowledge/${article.id}`, { folder: newFolder })
    }
    currentFolder.value = newPath
    await fetchArticles()
  } catch (e: any) {
    alert(e?.message || 'Fehler beim Umbenennen')
  }
}

function startCreate() {
  editingArticle.value = null
  editorTitle.value = ''
  editorContent.value = ''
  editorTags.value = ''
  editorFolder.value = currentFolder.value
  isEditing.value = true
  viewingArticle.value = null
}

function startEdit(article: Article) {
  editingArticle.value = article
  editorTitle.value = article.title
  editorContent.value = article.content
  editorTags.value = article.tags?.join(', ') || ''
  editorFolder.value = article.folder || ''
  isEditing.value = true
  viewingArticle.value = null
}

function cancelEdit() {
  isEditing.value = false
  editingArticle.value = null
}

// Extract #hashtags from HTML content
function extractHashtags(html: string): string[] {
  // Remove HTML tags to get plain text, then find hashtags
  const text = html.replace(/<[^>]+>/g, ' ')
  const matches = text.match(/#[\wäöüÄÖÜß]+/g) || []
  return [...new Set(matches.map(t => t.slice(1).toLowerCase()))]
}

async function saveArticle() {
  if (!editorTitle.value.trim()) {
    alert('Titel erforderlich')
    return
  }
  
  // Manual tags from input
  const manualTags = editorTags.value
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
  
  // Auto-extracted hashtags from content
  const hashTags = extractHashtags(editorContent.value)
  
  // Merge and dedupe
  const tags = [...new Set([...manualTags, ...hashTags])]

  try {
    let savedArticle: Article
    if (editingArticle.value) {
      const res = await api.put<{ article: Article }>(`/api/knowledge/${editingArticle.value.id}`, {
        title: editorTitle.value,
        content: editorContent.value,
        tags,
        folder: editorFolder.value
      })
      savedArticle = res.article
    } else {
      const res = await api.post<{ article: Article }>('/api/knowledge', {
        title: editorTitle.value,
        content: editorContent.value,
        tags,
        folder: editorFolder.value
      })
      savedArticle = res.article
    }
    isEditing.value = false
    editingArticle.value = null
    await fetchArticles()
    // Show the saved article
    viewingArticle.value = articles.value.find(a => a.id === savedArticle.id) || savedArticle
  } catch (e: any) {
    alert(e?.message || 'Fehler beim Speichern')
  }
}

async function deleteArticle(article: Article) {
  if (!confirm(`"${article.title}" wirklich löschen?`)) return
  try {
    await api.delete(`/api/knowledge/${article.id}`)
    if (viewingArticle.value?.id === article.id) {
      viewingArticle.value = null
    }
    await fetchArticles()
  } catch (e: any) {
    alert(e?.message || 'Fehler beim Löschen')
  }
}

function viewArticle(article: Article) {
  viewingArticle.value = article
  currentFolder.value = '' // Clear folder selection when viewing article
  isEditing.value = false
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('de-AT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  } catch { return iso }
}

// Highlight hashtags in content for display
function highlightHashtags(html: string): string {
  // Match #hashtag but not inside HTML tags
  return html.replace(/(^|[^&\w])#([\wäöüÄÖÜß]+)/g, '$1<span class="hashtag">#$2</span>')
}
onMounted(fetchArticles)
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <!-- Tree Sidebar -->
    <aside
      :class="[
        'flex-shrink-0 border-r border-gray-700 bg-gray-800/50 transition-all duration-200 flex flex-col',
        sidebarCollapsed ? 'w-12' : 'w-56'
      ]"
    >
      <div class="p-3 border-b border-gray-700 flex items-center justify-between">
        <span v-if="!sidebarCollapsed" class="font-semibold text-sm">📚 Wiki</span>
        <button
          @click="sidebarCollapsed = !sidebarCollapsed"
          class="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
        >{{ sidebarCollapsed ? '▶' : '◀' }}</button>
      </div>

      <!-- Folder Tree with Articles -->
      <div v-if="!sidebarCollapsed" class="flex-1 overflow-y-auto p-2 text-sm">
        
        <!-- Folder management buttons -->
        <div class="flex gap-1 mb-2 px-1">
          <button @click="createFolder" class="flex-1 py-1 px-2 bg-gray-700/50 hover:bg-gray-700 rounded text-xs text-gray-400 hover:text-white" title="Neuer Ordner">📁+ Ordner</button>
          <button v-if="currentFolder" @click="renameCurrentFolder" class="p-1 bg-gray-700/50 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title="Umbenennen">✏️</button>
          <button v-if="currentFolder" @click="deleteCurrentFolder" class="p-1 bg-gray-700/50 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400" title="Löschen">🗑️</button>
        </div>

        <!-- Wiki Root (selectable, contains root articles + folders) -->
        <div class="mb-1">
          <div 
            :class="[
              'flex items-center gap-1 px-1 py-1 text-xs font-medium cursor-pointer rounded',
              currentFolder === '' ? 'bg-rose-500/20 text-rose-300' : 'text-gray-300 hover:text-white hover:bg-gray-700/30'
            ]"
          >
            <button @click="toggleFolder('')" class="w-3">{{ expandedFolders.has('') ? '▼' : '▶' }}</button>
            <button @click="selectFolder(''); expandedFolders.add(''); expandedFolders = new Set(expandedFolders)" class="flex-1 text-left flex items-center gap-1">
              <span>📚</span>
              <span>Wiki</span>
            </button>
          </div>
          
          <!-- Wiki contents when expanded -->
          <div v-if="expandedFolders.has('')" class="ml-3 pl-2 border-l border-gray-700/50">
            <!-- Root level articles (no folder) -->
            <template v-for="article in articles.filter(a => !a.folder)" :key="article.id">
              <button
                v-show="articleMatchesFilter(article)"
                @click="viewArticle(article)"
                :class="[
                  'w-full text-left px-2 py-1 rounded truncate text-xs flex items-center gap-1',
                  viewingArticle?.id === article.id ? 'bg-rose-500/20 text-rose-300' : 'hover:bg-gray-700/50 text-gray-400'
                ]"
              >
                <span>📄</span>
                <span class="truncate">{{ article.title }}</span>
              </button>
            </template>
            
            <!-- Folders with their articles -->
        <template v-for="folder in folderTree.children" :key="folder.path">
          <div class="mb-1" v-show="folderHasMatches(folder.path)">
            <div 
              :class="[
                'flex items-center gap-1 px-1 py-1 rounded cursor-pointer group',
                currentFolder === folder.path ? 'bg-rose-500/10' : 'hover:bg-gray-700/30'
              ]"
            >
              <button
                @click="toggleFolder(folder.path)"
                class="text-xs text-gray-500 hover:text-white w-3"
              >{{ expandedFolders.has(folder.path) || folder.children.length > 0 || folder.articles.length > 0 ? (expandedFolders.has(folder.path) ? '▼' : '▶') : ' ' }}</button>
              <button
                @click="selectFolder(folder.path)"
                :class="[
                  'flex-1 flex items-center gap-1 truncate text-xs',
                  currentFolder === folder.path ? 'text-rose-300' : 'text-gray-400 hover:text-white'
                ]"
              >
                <span>📂</span>
                <span class="truncate">{{ folder.name }}</span>
              </button>
              <span class="text-[10px] text-gray-600">{{ folder.articles.length }}</span>
            </div>
            
            <!-- Folder contents when expanded -->
            <div v-if="expandedFolders.has(folder.path)" class="ml-3 pl-2 border-l border-gray-700/50">
              <!-- Subfolders -->
              <template v-for="child in folder.children" :key="child.path">
                <div class="mb-0.5" v-show="folderHasMatches(child.path)">
                  <div 
                    :class="[
                      'flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer',
                      currentFolder === child.path ? 'bg-rose-500/10' : 'hover:bg-gray-700/30'
                    ]"
                  >
                    <button @click="toggleFolder(child.path)" class="text-[10px] text-gray-500 w-3">{{ expandedFolders.has(child.path) ? '▼' : '▶' }}</button>
                    <button
                      @click="selectFolder(child.path)"
                      :class="['flex-1 flex items-center gap-1 truncate text-[11px]', currentFolder === child.path ? 'text-rose-300' : 'text-gray-400']"
                    >
                      <span>📂</span>
                      <span class="truncate">{{ child.name }}</span>
                    </button>
                    <span class="text-[10px] text-gray-600">{{ child.articles.length }}</span>
                  </div>
                  <!-- Child folder articles -->
                  <div v-if="expandedFolders.has(child.path)" class="ml-3 pl-2 border-l border-gray-700/50">
                    <button
                      v-for="article in child.articles"
                      :key="article.id"
                      v-show="articleMatchesFilter(article)"
                      @click="viewArticle(article)"
                      :class="['w-full text-left px-1 py-0.5 rounded truncate text-[11px] flex items-center gap-1', viewingArticle?.id === article.id ? 'bg-rose-500/20 text-rose-300' : 'hover:bg-gray-700/50 text-gray-500']"
                    >
                      <span>📄</span>
                      <span class="truncate">{{ article.title }}</span>
                    </button>
                  </div>
                </div>
              </template>
              
              <!-- Articles in this folder -->
              <button
                v-for="article in folder.articles"
                :key="article.id"
                v-show="articleMatchesFilter(article)"
                @click="viewArticle(article)"
                :class="[
                  'w-full text-left px-2 py-1 rounded truncate text-xs flex items-center gap-1',
                  viewingArticle?.id === article.id ? 'bg-rose-500/20 text-rose-300' : 'hover:bg-gray-700/50 text-gray-500'
                ]"
              >
                <span>📄</span>
                <span class="truncate">{{ article.title }}</span>
              </button>
            </div>
          </div>
        </template>
          </div>
        </div>

        <!-- Tag Filter Section -->
        <div v-if="allTags.length > 0" class="mt-4 pt-3 border-t border-gray-700">
          <div class="text-xs text-gray-500 px-2 mb-2">🏷️ Tags filtern</div>
          <div class="flex flex-wrap gap-1 px-1">
            <button
              v-for="tag in allTags"
              :key="tag"
              @click="toggleTag(tag)"
              :class="[
                'text-[10px] px-2 py-0.5 rounded-full transition-colors',
                selectedTags.includes(tag)
                  ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50'
                  : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
              ]"
            >{{ tag }}</button>
          </div>
        </div>
      </div>

      <!-- Collapsed view -->
      <div v-else class="flex-1 flex flex-col items-center pt-2 gap-2">
        <button @click="sidebarCollapsed = false" class="p-2 rounded hover:bg-gray-700" title="Sidebar öffnen">📚</button>
      </div>

      <!-- New Article Button -->
      <div class="p-2 border-t border-gray-700">
        <button
          @click="startCreate"
          :class="['w-full py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-sm font-medium', sidebarCollapsed ? 'px-2' : 'px-4']"
        >{{ sidebarCollapsed ? '+' : '+ Neuer Artikel' }}</button>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Search bar -->
      <div class="p-3 border-b border-gray-700 flex gap-3 items-center">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="🔍 Suchen..."
          class="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-rose-500 text-sm"
        />
      </div>

      <!-- Active tag filters -->
      <div v-if="selectedTags.length > 0" class="px-3 py-2 border-b border-gray-700 flex gap-2 items-center">
        <span class="text-xs text-gray-500">Filter:</span>
        <button
          v-for="tag in selectedTags"
          :key="tag"
          @click="toggleTag(tag)"
          class="text-xs px-2 py-0.5 bg-rose-500/20 text-rose-300 rounded-full flex items-center gap-1"
        >{{ tag }} <span class="text-rose-400">×</span></button>
      </div>

      <!-- Loading/Error -->
      <div v-if="loading" class="text-gray-400 text-center py-8">Laden...</div>
      <div v-else-if="error" class="text-red-400 text-center py-8">{{ error }}</div>

      <!-- Content -->
      <div v-else class="flex-1 overflow-hidden flex">
        <!-- Article Viewer -->
        <div v-if="viewingArticle && !isEditing" class="flex-1 overflow-y-auto p-4 md:p-6">
          <div class="flex items-start justify-between gap-4 mb-4">
            <h2 class="text-xl md:text-2xl font-bold">{{ viewingArticle.title }}</h2>
            <div class="flex gap-2 flex-shrink-0">
              <button @click="startEdit(viewingArticle)" class="p-2 hover:bg-gray-700 rounded-lg" title="Bearbeiten">✏️</button>
              <button @click="deleteArticle(viewingArticle)" class="p-2 hover:bg-gray-700 rounded-lg text-red-400" title="Löschen">🗑️</button>
              <button @click="viewingArticle = null" class="p-2 hover:bg-gray-700 rounded-lg md:hidden">✕</button>
            </div>
          </div>
          <div v-if="viewingArticle.tags?.length" class="flex flex-wrap gap-2 mb-4">
            <span v-for="tag in viewingArticle.tags" :key="tag" class="text-sm px-3 py-1 bg-rose-500/20 text-rose-300 rounded-full cursor-pointer hover:bg-rose-500/30" @click="toggleTag(tag)">{{ tag }}</span>
          </div>
          <div class="text-xs text-gray-500 mb-4">
            {{ viewingArticle.author === 'chatty' ? '🤖 Chatty' : '👤 ' + viewingArticle.author }} ·
            <span v-if="viewingArticle.folder">📁 {{ viewingArticle.folder }} · </span>
            {{ formatDate(viewingArticle.updatedAt) }}
          </div>
          <div class="prose prose-invert max-w-none text-gray-200" v-html="highlightHashtags(viewingArticle.content)"></div>
        </div>

        <!-- Editor -->
        <div v-if="isEditing" class="flex-1 overflow-y-auto p-4 md:p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold">{{ editingArticle ? 'Bearbeiten' : 'Neuer Artikel' }}</h2>
            <button @click="cancelEdit" class="p-2 hover:bg-gray-700 rounded-lg">✕</button>
          </div>
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Titel</label>
              <input v-model="editorTitle" type="text" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-rose-500" placeholder="Artikel-Titel" />
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Ordner</label>
              <input v-model="editorFolder" type="text" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-rose-500" placeholder="z.B. docs/api (leer = Root)" />
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Tags (kommagetrennt)</label>
              <input v-model="editorTags" type="text" class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-rose-500" placeholder="tag1, tag2" />
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Inhalt</label>
              <WysiwygEditor v-model="editorContent" placeholder="Schreibe hier..." />
            </div>
            <div class="flex gap-3">
              <button @click="saveArticle" class="px-6 py-2 bg-rose-500 hover:bg-rose-600 rounded-lg font-medium">Speichern</button>
              <button @click="cancelEdit" class="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium">Abbrechen</button>
            </div>
          </div>
        </div>

        <!-- Empty state - only show when list is in sidebar mode (something could be selected) -->
        <div v-if="!viewingArticle && !isEditing" class="hidden md:flex flex-1 items-center justify-center text-gray-500 bg-gray-900/30">
          <div class="text-center"><div class="text-4xl mb-3">📚</div><p>Wähle einen Artikel</p></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>

<style>
/* Article content styles (not scoped to allow v-html styling) */
.prose h1 { font-size: 1.75rem; font-weight: bold; margin: 1.5rem 0 0.75rem; color: white; }
.prose h2 { font-size: 1.4rem; font-weight: bold; margin: 1.25rem 0 0.5rem; color: white; }
.prose h3 { font-size: 1.15rem; font-weight: 600; margin: 1rem 0 0.5rem; color: #e5e7eb; }
.prose p { margin: 0.75rem 0; }
.prose ul, .prose ol { padding-left: 1.5rem; margin: 0.75rem 0; }
.prose li { margin: 0.25rem 0; }
.prose blockquote { border-left: 3px solid #f43f5e; padding-left: 1rem; margin: 0.75rem 0; color: #9ca3af; font-style: italic; }
.prose pre { background: #1f2937; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.75rem 0; }
.prose code { background: #1f2937; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875rem; color: #fda4af; }
.prose pre code { background: none; padding: 0; color: #e5e7eb; }
.prose a { color: #f43f5e; text-decoration: underline; }
.prose strong { color: white; }
.prose .hashtag { color: #f43f5e; font-weight: 500; }
</style>
