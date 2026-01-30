<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'

interface CertCheck {
  id: string
  url: string
  lastCheck?: string
  validFrom?: string
  validTo?: string
  daysUntilExpiry?: number
  issuer?: string
  status: 'ok' | 'warning' | 'error' | 'pending'
  error?: string
}

interface HealthCheck {
  id: string
  url: string
  name?: string
  lastCheck?: string
  lastStatus?: number
  lastResponseTime?: number
  status: 'up' | 'down' | 'pending'
  error?: string
  uptimePercent?: number
}

const certChecks = ref<CertCheck[]>([])
const healthChecks = ref<HealthCheck[]>([])
const loading = ref(false)
const activeTab = ref<'certs' | 'health'>('certs')

// New site forms
const newCertUrl = ref('')
const newHealthUrl = ref('')
const newHealthName = ref('')
const addingCert = ref(false)
const addingHealth = ref(false)

// Load data
async function loadData() {
  loading.value = true
  try {
    const [certsRes, healthRes] = await Promise.all([
      api.get('/api/monitoring/certs'),
      api.get('/api/monitoring/health')
    ])
    certChecks.value = certsRes.certs || []
    healthChecks.value = healthRes.health || []
  } catch (e) {
    console.error('Failed to load monitoring data:', e)
  } finally {
    loading.value = false
  }
}

// Add certificate check
async function addCertCheck() {
  if (!newCertUrl.value.trim()) return
  addingCert.value = true
  try {
    let url = newCertUrl.value.trim()
    if (!url.startsWith('http')) url = 'https://' + url
    
    const res = await api.post('/api/monitoring/certs', { url })
    certChecks.value.push(res.check)
    newCertUrl.value = ''
  } catch (e: any) {
    alert(e?.response?.data?.error || 'Fehler beim Hinzufügen')
  } finally {
    addingCert.value = false
  }
}

// Remove certificate check
async function removeCertCheck(id: string) {
  if (!confirm('Wirklich entfernen?')) return
  try {
    await api.delete(`/api/monitoring/certs/${id}`)
    certChecks.value = certChecks.value.filter(c => c.id !== id)
  } catch (e) {
    console.error('Failed to remove cert check:', e)
  }
}

// Add health check
async function addHealthCheck() {
  if (!newHealthUrl.value.trim()) return
  addingHealth.value = true
  try {
    let url = newHealthUrl.value.trim()
    if (!url.startsWith('http')) url = 'https://' + url
    
    const res = await api.post('/api/monitoring/health', { 
      url,
      name: newHealthName.value.trim() || undefined
    })
    healthChecks.value.push(res.check)
    newHealthUrl.value = ''
    newHealthName.value = ''
  } catch (e: any) {
    alert(e?.response?.data?.error || 'Fehler beim Hinzufügen')
  } finally {
    addingHealth.value = false
  }
}

// Remove health check
async function removeHealthCheck(id: string) {
  if (!confirm('Wirklich entfernen?')) return
  try {
    await api.delete(`/api/monitoring/health/${id}`)
    healthChecks.value = healthChecks.value.filter(c => c.id !== id)
  } catch (e) {
    console.error('Failed to remove health check:', e)
  }
}

// Trigger manual check
async function runCertChecks() {
  loading.value = true
  try {
    const res = await api.post('/api/monitoring/certs/check-all')
    certChecks.value = res.certs || certChecks.value
  } catch (e) {
    console.error('Check failed:', e)
  } finally {
    loading.value = false
  }
}

async function runHealthChecks() {
  loading.value = true
  try {
    const res = await api.post('/api/monitoring/health/check-all')
    healthChecks.value = res.health || healthChecks.value
  } catch (e) {
    console.error('Check failed:', e)
  } finally {
    loading.value = false
  }
}

// Status helpers
function getCertStatusColor(check: CertCheck) {
  if (check.status === 'error') return 'text-red-400'
  if (check.status === 'warning' || (check.daysUntilExpiry && check.daysUntilExpiry < 30)) return 'text-amber-400'
  if (check.status === 'ok') return 'text-green-400'
  return 'text-gray-400'
}

function getCertStatusIcon(check: CertCheck) {
  if (check.status === 'error') return '❌'
  if (check.status === 'warning' || (check.daysUntilExpiry && check.daysUntilExpiry < 30)) return '⚠️'
  if (check.status === 'ok') return '✅'
  return '⏳'
}

function getHealthStatusColor(check: HealthCheck) {
  if (check.status === 'down') return 'text-red-400'
  if (check.status === 'up') return 'text-green-400'
  return 'text-gray-400'
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

function formatTime(dateStr?: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// Stats
const certStats = computed(() => {
  const total = certChecks.value.length
  const ok = certChecks.value.filter(c => c.status === 'ok' && (!c.daysUntilExpiry || c.daysUntilExpiry >= 30)).length
  const warning = certChecks.value.filter(c => c.status === 'warning' || (c.daysUntilExpiry && c.daysUntilExpiry < 30 && c.daysUntilExpiry > 0)).length
  const error = certChecks.value.filter(c => c.status === 'error' || (c.daysUntilExpiry && c.daysUntilExpiry <= 0)).length
  return { total, ok, warning, error }
})

const healthStats = computed(() => {
  const total = healthChecks.value.length
  const up = healthChecks.value.filter(c => c.status === 'up').length
  const down = healthChecks.value.filter(c => c.status === 'down').length
  return { total, up, down }
})

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold flex items-center gap-2">
            🔍 Monitoring
          </h1>
          <p class="text-gray-400 text-sm mt-1">
            Zertifikate & Health Checks für deine Websites
          </p>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex gap-2 border-b border-gray-700 pb-2">
        <button
          @click="activeTab = 'certs'"
          :class="[
            'px-4 py-2 rounded-t-lg transition-colors',
            activeTab === 'certs' 
              ? 'bg-gray-800 text-white' 
              : 'text-gray-400 hover:text-white'
          ]"
        >
          📜 Zertifikate
          <span 
            v-if="certStats.warning + certStats.error > 0"
            class="ml-2 px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-300"
          >
            {{ certStats.warning + certStats.error }}
          </span>
        </button>
        <button
          @click="activeTab = 'health'"
          :class="[
            'px-4 py-2 rounded-t-lg transition-colors',
            activeTab === 'health' 
              ? 'bg-gray-800 text-white' 
              : 'text-gray-400 hover:text-white'
          ]"
        >
          🏥 Health Checks
          <span 
            v-if="healthStats.down > 0"
            class="ml-2 px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-300"
          >
            {{ healthStats.down }}
          </span>
        </button>
      </div>

      <!-- Certificate Checks Tab -->
      <div v-if="activeTab === 'certs'" class="space-y-4">
        <!-- Stats -->
        <div class="grid grid-cols-4 gap-3">
          <div class="bg-gray-800/50 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold">{{ certStats.total }}</div>
            <div class="text-xs text-gray-400">Gesamt</div>
          </div>
          <div class="bg-green-500/10 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold text-green-400">{{ certStats.ok }}</div>
            <div class="text-xs text-gray-400">OK</div>
          </div>
          <div class="bg-amber-500/10 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold text-amber-400">{{ certStats.warning }}</div>
            <div class="text-xs text-gray-400">Warnung</div>
          </div>
          <div class="bg-red-500/10 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold text-red-400">{{ certStats.error }}</div>
            <div class="text-xs text-gray-400">Fehler</div>
          </div>
        </div>

        <!-- Add new -->
        <div class="flex gap-2">
          <input
            v-model="newCertUrl"
            type="text"
            placeholder="https://example.com"
            class="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-rose-500"
            @keyup.enter="addCertCheck"
          >
          <button
            @click="addCertCheck"
            :disabled="addingCert || !newCertUrl.trim()"
            class="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 rounded-lg transition-colors"
          >
            {{ addingCert ? '...' : '+ Hinzufügen' }}
          </button>
          <button
            @click="runCertChecks"
            :disabled="loading"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            title="Alle prüfen"
          >
            🔄
          </button>
        </div>

        <!-- List -->
        <div v-if="loading && certChecks.length === 0" class="text-center py-8 text-gray-500">
          Laden...
        </div>

        <div v-else-if="certChecks.length === 0" class="text-center py-8 text-gray-500">
          Noch keine Zertifikate überwacht.<br>
          Füge oben eine URL hinzu!
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="check in certChecks"
            :key="check.id"
            class="bg-gray-800/50 rounded-lg p-4 flex items-center gap-4"
          >
            <span class="text-2xl">{{ getCertStatusIcon(check) }}</span>
            
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">{{ extractDomain(check.url) }}</div>
              <div class="text-sm text-gray-400">
                <span v-if="check.error" class="text-red-400">{{ check.error }}</span>
                <span v-else-if="check.validTo">
                  Gültig bis: {{ formatDate(check.validTo) }}
                  <span v-if="check.daysUntilExpiry !== undefined" :class="getCertStatusColor(check)">
                    ({{ check.daysUntilExpiry }} Tage)
                  </span>
                </span>
                <span v-else>Noch nicht geprüft</span>
              </div>
              <div v-if="check.issuer" class="text-xs text-gray-500 truncate">
                Aussteller: {{ check.issuer }}
              </div>
            </div>

            <div class="text-xs text-gray-500 text-right hidden sm:block">
              <div v-if="check.lastCheck">
                Geprüft: {{ formatTime(check.lastCheck) }}
              </div>
            </div>

            <button
              @click="removeCertCheck(check.id)"
              class="text-gray-500 hover:text-red-400 transition-colors"
              title="Entfernen"
            >
              🗑️
            </button>
          </div>
        </div>

        <p class="text-xs text-gray-500 text-center">
          ℹ️ Zertifikate werden täglich automatisch geprüft
        </p>
      </div>

      <!-- Health Checks Tab -->
      <div v-if="activeTab === 'health'" class="space-y-4">
        <!-- Stats -->
        <div class="grid grid-cols-3 gap-3">
          <div class="bg-gray-800/50 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold">{{ healthStats.total }}</div>
            <div class="text-xs text-gray-400">Gesamt</div>
          </div>
          <div class="bg-green-500/10 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold text-green-400">{{ healthStats.up }}</div>
            <div class="text-xs text-gray-400">Online</div>
          </div>
          <div class="bg-red-500/10 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold text-red-400">{{ healthStats.down }}</div>
            <div class="text-xs text-gray-400">Offline</div>
          </div>
        </div>

        <!-- Add new -->
        <div class="flex gap-2">
          <input
            v-model="newHealthName"
            type="text"
            placeholder="Name (optional)"
            class="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-rose-500"
          >
          <input
            v-model="newHealthUrl"
            type="text"
            placeholder="https://example.com/health"
            class="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-rose-500"
            @keyup.enter="addHealthCheck"
          >
          <button
            @click="addHealthCheck"
            :disabled="addingHealth || !newHealthUrl.trim()"
            class="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 rounded-lg transition-colors"
          >
            {{ addingHealth ? '...' : '+ Hinzufügen' }}
          </button>
          <button
            @click="runHealthChecks"
            :disabled="loading"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            title="Alle prüfen"
          >
            🔄
          </button>
        </div>

        <!-- List -->
        <div v-if="loading && healthChecks.length === 0" class="text-center py-8 text-gray-500">
          Laden...
        </div>

        <div v-else-if="healthChecks.length === 0" class="text-center py-8 text-gray-500">
          Noch keine Health Checks eingerichtet.<br>
          Füge oben eine URL hinzu!
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="check in healthChecks"
            :key="check.id"
            class="bg-gray-800/50 rounded-lg p-4 flex items-center gap-4"
          >
            <div 
              class="w-3 h-3 rounded-full"
              :class="check.status === 'up' ? 'bg-green-400' : check.status === 'down' ? 'bg-red-400' : 'bg-gray-400'"
            />
            
            <div class="flex-1 min-w-0">
              <div class="font-medium">
                {{ check.name || extractDomain(check.url) }}
              </div>
              <div class="text-sm text-gray-400 truncate">
                {{ check.url }}
              </div>
              <div class="text-xs mt-1" :class="getHealthStatusColor(check)">
                <span v-if="check.error">{{ check.error }}</span>
                <span v-else-if="check.lastStatus">
                  HTTP {{ check.lastStatus }}
                  <span v-if="check.lastResponseTime" class="text-gray-500">
                    • {{ check.lastResponseTime }}ms
                  </span>
                </span>
                <span v-else class="text-gray-500">Noch nicht geprüft</span>
              </div>
            </div>

            <div class="text-xs text-gray-500 text-right hidden sm:block">
              <div v-if="check.lastCheck">
                {{ formatTime(check.lastCheck) }}
              </div>
              <div v-if="check.uptimePercent !== undefined" class="text-green-400">
                {{ check.uptimePercent.toFixed(1) }}% Uptime
              </div>
            </div>

            <button
              @click="removeHealthCheck(check.id)"
              class="text-gray-500 hover:text-red-400 transition-colors"
              title="Entfernen"
            >
              🗑️
            </button>
          </div>
        </div>

        <p class="text-xs text-gray-500 text-center">
          ℹ️ Health Checks laufen alle 15 Minuten • Bei Ausfall erhältst du eine Email
        </p>
      </div>
    </div>
  </div>
</template>
