import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import { v4 as uuidv4 } from 'uuid'
import { config } from 'dotenv'
import path from 'path'
import { readFileSync, writeFileSync, existsSync, promises as fsp } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

config()

const app = express()
app.use(cors())
app.use(express.json())

const JWT_SECRET = process.env.JWT_SECRET || 'chatty-cockpit-secret-change-me'
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || 'phofmann@delta-mind.at').split(',')
const APP_URL = process.env.APP_URL || 'https://app.chatty.delta-mind.at'
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789'
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || ''
const TASKS_FILE = '/home/ubuntu/clawd/kanban-tasks.json'
const EVENTS_FILE = '/home/ubuntu/clawd/calendar-events.json'
const ACTIVITY_LOG_FILE = '/home/ubuntu/clawd/activity-log.jsonl'

// Reminders storage (per user)
const REMINDERS_ROOT = '/home/ubuntu/clawd/reminders'
const REMINDERS_INTERNAL_SECRET = process.env.REMINDERS_INTERNAL_SECRET || ''

// File storage
const FILES_ROOT = '/home/ubuntu/clawd/files'
const MAX_UPLOAD_MB = 50

const magicTokens = new Map<string, { email: string; expires: number }>()

const transporter = nodemailer.createTransport({
  host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false }
})

// Task storage helpers
interface Task {
  id: string
  title: string
  description?: string
  column: string
  priority?: string
  createdAt: string
  createdBy: string
}

function loadTasks(): Task[] {
  try {
    if (existsSync(TASKS_FILE)) {
      return JSON.parse(readFileSync(TASKS_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load tasks:', e)
  }
  return []
}

function saveTasks(tasks: Task[]) {
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2))
}

// Calendar event storage helpers
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

function loadEvents(): CalendarEvent[] {
  try {
    if (existsSync(EVENTS_FILE)) {
      return JSON.parse(readFileSync(EVENTS_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load events:', e)
  }
  return []
}

function saveEvents(events: CalendarEvent[]) {
  writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2))
}

// Reminders storage helpers
type ReminderStatus = 'open' | 'done'
type ReminderSource = 'manual' | 'cron' | 'telegram'

interface Reminder {
  id: string
  title: string
  body?: string
  dueAt: string // ISO
  status: ReminderStatus
  createdAt: string
  updatedAt: string
  source?: ReminderSource
  tags?: string[]
}

function getRemindersFile(email: string) {
  return path.resolve(REMINDERS_ROOT, `${sanitizeEmail(email)}.json`)
}

async function loadReminders(email: string): Promise<Reminder[]> {
  try {
    const file = getRemindersFile(email)
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, 'utf-8')) as Reminder[]
    }
  } catch (e) {
    console.error('Failed to load reminders:', e)
  }
  return []
}

async function saveReminders(email: string, reminders: Reminder[]) {
  await ensureDir(REMINDERS_ROOT)
  const file = getRemindersFile(email)
  writeFileSync(file, JSON.stringify(reminders, null, 2))
}

function sameTags(a?: string[], b?: string[]) {
  const aa = (a || []).slice().sort()
  const bb = (b || []).slice().sort()
  if (aa.length !== bb.length) return false
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false
  return true
}

// Activity log (append-only JSONL)
type ActivityType = 'kanban' | 'calendar' | 'files'
type ActivityAction =
  | 'created'
  | 'edited'
  | 'moved'
  | 'deleted'
  | 'uploaded'
  | 'folder_created'
  | 'renamed'
  | 'file_moved'

async function appendActivity(entry: {
  type: ActivityType
  action: ActivityAction
  userEmail?: string
  summary: string
  meta?: any
}) {
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    }) + '\n'

  try {
    await fsp.appendFile(ACTIVITY_LOG_FILE, line, 'utf8')

    // Rotate if too large (keep last N lines)
    const st = await fsp.stat(ACTIVITY_LOG_FILE)
    const MAX_BYTES = 5 * 1024 * 1024
    if (st.size > MAX_BYTES) {
      const txt = await fsp.readFile(ACTIVITY_LOG_FILE, 'utf8').catch(() => '')
      const lines = txt.split(/\r?\n/).filter(Boolean)
      const keep = lines.slice(Math.max(0, lines.length - 2000))
      await fsp.writeFile(ACTIVITY_LOG_FILE, keep.join('\n') + (keep.length ? '\n' : ''), 'utf8')
    }
  } catch (e) {
    console.error('Failed to append activity:', e)
  }
}

// Auth endpoints
app.post('/api/auth/magic-link', async (req, res) => {
  const { email } = req.body
  if (!email || !ALLOWED_EMAILS.includes(email.toLowerCase())) {
    return res.status(403).json({ error: 'Email not allowed' })
  }
  const token = uuidv4()
  magicTokens.set(token, { email: email.toLowerCase(), expires: Date.now() + 15 * 60 * 1000 })
  const magicLink = `${APP_URL}/auth/verify?token=${token}`
  try {
    await transporter.sendMail({
      from: '"Chatty Cockpit" <chatty@chatty.delta-mind.at>',
      to: email,
      subject: '🔐 Dein Magic Link fürs Cockpit',
      html: `<div style="font-family: sans-serif;"><h2 style="color: #e94560;">Hey! 👋</h2><p><a href="${magicLink}" style="padding: 12px 24px; background: #e94560; color: white; text-decoration: none; border-radius: 8px;">Jetzt anmelden</a></p><p style="color: #666;">Gültig für 15 Min.</p></div>`
    })
    res.json({ success: true })
  } catch (err) {
    console.error('Email error:', err)
    res.status(500).json({ error: 'Failed to send email' })
  }
})

app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body
  const data = magicTokens.get(token)
  if (!data || Date.now() > data.expires) {
    magicTokens.delete(token)
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  magicTokens.delete(token)
  res.json({ token: jwt.sign({ email: data.email }, JWT_SECRET, { expiresIn: '7d' }), email: data.email })
})

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    ;(req as any).user = jwt.verify(authHeader.slice(7), JWT_SECRET) as { email: string }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

function sanitizeEmail(email: string) {
  return email.toLowerCase().replace(/[^a-z0-9@._-]/g, '_')
}

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true })
}

function getUserRoot(email: string) {
  return path.resolve(FILES_ROOT, sanitizeEmail(email))
}

function resolveUnderUserRoot(userRoot: string, relPath: string | undefined) {
  const safeRel = (relPath || '').replace(/\\/g, '/')
  // Normalize as posix to avoid surprises, then join to userRoot.
  const normalized = path.posix.normalize('/' + safeRel).replace(/^\/+/, '')
  const abs = path.resolve(userRoot, normalized)
  const root = path.resolve(userRoot)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Invalid path')
  }
  return abs
}

function parseMultipartSingleFile(body: Buffer, contentType: string | undefined) {
  if (!contentType) throw new Error('Missing Content-Type')
  const m = contentType.match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i)
  const boundary = (m?.[1] || m?.[2])?.trim()
  if (!boundary) throw new Error('Invalid multipart boundary')

  const boundaryBuf = Buffer.from(`--${boundary}`)
  let idx = body.indexOf(boundaryBuf)
  while (idx !== -1) {
    const partStart = idx + boundaryBuf.length
    // End marker
    if (body.slice(partStart, partStart + 2).toString() === '--') break

    const headersStart = partStart + 2 // \r\n
    const headersEnd = body.indexOf(Buffer.from('\r\n\r\n'), headersStart)
    if (headersEnd === -1) break

    const headersText = body.slice(headersStart, headersEnd).toString('utf8')
    const fileNameMatch = headersText.match(/filename="([^"]*)"/i)

    const dataStart = headersEnd + 4
    const nextBoundary = body.indexOf(boundaryBuf, dataStart)
    if (nextBoundary === -1) break

    const dataEnd = nextBoundary - 2 // strip trailing \r\n
    const data = body.slice(dataStart, dataEnd)

    if (fileNameMatch && fileNameMatch[1]) {
      const filename = path.basename(fileNameMatch[1])
      return { filename, data }
    }

    idx = nextBoundary
  }

  throw new Error('No file found in multipart data')
}

// Chat via OpenAI-compatible Gateway API
app.post('/api/chat/message', authMiddleware, async (req, res) => {
  const { message } = req.body
  const user = (req as any).user
  
  if (!message) return res.status(400).json({ error: 'Message required' })
  
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'x-clawdbot-agent-id': 'main'
      },
      body: JSON.stringify({
        model: 'clawdbot:main',
        user: `cockpit-${user.email}`,
        messages: [{ role: 'user', content: `[Web Cockpit - ${user.email}] ${message}` }]
      })
    })
    
    if (!response.ok) throw new Error(`Gateway error: ${response.status}`)
    
    const data = await response.json() as any
    res.json({ message: data.choices?.[0]?.message?.content || 'Nachricht erhalten! 💬' })
  } catch (err) {
    console.error('Chat error:', err)
    res.json({ message: 'Entschuldige, da ist etwas schiefgelaufen. 🔄' })
  }
})

// Kanban endpoints
app.get('/api/kanban/tasks', authMiddleware, (req, res) => {
  const tasks = loadTasks()
  res.json({ tasks })
})

app.post('/api/kanban/tasks', authMiddleware, async (req, res) => {
  const { title, description, column, priority } = req.body
  const user = (req as any).user
  
  if (!title) return res.status(400).json({ error: 'Title required' })
  
  const task: Task = {
    id: uuidv4(),
    title,
    description,
    column: column || 'backlog',
    priority,
    createdAt: new Date().toISOString(),
    createdBy: user.email
  }
  
  const tasks = loadTasks()
  tasks.push(task)
  saveTasks(tasks)

  await appendActivity({
    type: 'kanban',
    action: 'created',
    userEmail: user.email,
    summary: `Task created: ${task.title}`,
    meta: { id: task.id, column: task.column, priority: task.priority }
  })
  
  res.json({ task })
})

app.patch('/api/kanban/tasks/:id', authMiddleware, async (req, res) => {
  const { id } = req.params
  const updates = req.body
  const user = (req as any).user
  
  const tasks = loadTasks()
  const task = tasks.find(t => t.id === id)
  
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const beforeColumn = task.column

  Object.assign(task, updates)
  saveTasks(tasks)

  if (updates?.column !== undefined && beforeColumn !== task.column) {
    await appendActivity({
      type: 'kanban',
      action: 'moved',
      userEmail: user.email,
      summary: `Task moved: ${task.title} (${beforeColumn} → ${task.column})`,
      meta: { id: task.id, from: beforeColumn, to: task.column }
    })
  } else {
    await appendActivity({
      type: 'kanban',
      action: 'edited',
      userEmail: user.email,
      summary: `Task updated: ${task.title}`,
      meta: { id: task.id, updates }
    })
  }
  
  res.json({ task })
})

app.delete('/api/kanban/tasks/:id', authMiddleware, async (req, res) => {
  const { id } = req.params
  const user = (req as any).user
  
  const tasks = loadTasks()
  const task = tasks.find(t => t.id === id)
  const next = tasks.filter(t => t.id !== id)
  saveTasks(next)

  await appendActivity({
    type: 'kanban',
    action: 'deleted',
    userEmail: user.email,
    summary: `Task deleted: ${task?.title || id}`,
    meta: { id, column: task?.column }
  })
  
  res.json({ success: true })
})

// Calendar endpoints
app.get('/api/calendar/events', authMiddleware, (req, res) => {
  const events = loadEvents()
  const month = req.query.month as string | undefined // e.g. "2026-01"
  
  if (month) {
    const filtered = events.filter(e => e.start.startsWith(month))
    return res.json({ events: filtered })
  }
  
  res.json({ events })
})

app.post('/api/calendar/events', authMiddleware, (req, res) => {
  const { title, start, end, description, category } = req.body
  const user = (req as any).user
  
  if (!title || !start) return res.status(400).json({ error: 'Title and start required' })
  
  const event: CalendarEvent = {
    id: uuidv4(),
    title,
    start,
    end: end || undefined,
    description: description || undefined,
    category: category || undefined,
    createdBy: user.email,
    createdAt: new Date().toISOString()
  }
  
  const events = loadEvents()
  events.push(event)
  saveEvents(events)
  
  res.json({ event })
})

app.patch('/api/calendar/events/:id', authMiddleware, (req, res) => {
  const { id } = req.params
  const updates = req.body
  
  const events = loadEvents()
  const event = events.find(e => e.id === id)
  
  if (!event) return res.status(404).json({ error: 'Event not found' })
  
  // Only update allowed fields
  if (updates.title !== undefined) event.title = updates.title
  if (updates.start !== undefined) event.start = updates.start
  if (updates.end !== undefined) event.end = updates.end
  if (updates.description !== undefined) event.description = updates.description
  if (updates.category !== undefined) event.category = updates.category
  
  saveEvents(events)
  
  res.json({ event })
})

app.delete('/api/calendar/events/:id', authMiddleware, (req, res) => {
  const { id } = req.params
  
  let events = loadEvents()
  events = events.filter(e => e.id !== id)
  saveEvents(events)
  
  res.json({ success: true })
})

// Files endpoints (simple Dropbox-like MVP)
app.get('/api/files/list', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  try {
    const userRoot = getUserRoot(user.email)
    await ensureDir(userRoot)

    const rel = (req.query.path as string | undefined) || ''
    const abs = resolveUnderUserRoot(userRoot, rel)

    const dirents = await fsp.readdir(abs, { withFileTypes: true })
    const items = await Promise.all(
      dirents
        .filter(d => d.name !== '.DS_Store')
        .map(async d => {
          const p = path.join(abs, d.name)
          const st = await fsp.stat(p)
          return {
            name: d.name,
            type: d.isDirectory() ? 'folder' : 'file',
            size: d.isDirectory() ? 0 : st.size,
            mtime: st.mtimeMs
          }
        })
    )

    res.json({ items })
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to list' })
  }
})

app.post('/api/files/folder', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const { path: relPath, name } = req.body as { path?: string; name?: string }
  if (!name) return res.status(400).json({ error: 'name required' })

  try {
    const userRoot = getUserRoot(user.email)
    await ensureDir(userRoot)

    const parentAbs = resolveUnderUserRoot(userRoot, relPath || '')
    const dirAbs = resolveUnderUserRoot(userRoot, (relPath ? relPath + '/' : '') + name)

    // Ensure parent exists
    await ensureDir(parentAbs)
    await fsp.mkdir(dirAbs, { recursive: true })

    res.json({ success: true })
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to create folder' })
  }
})

app.post(
  '/api/files/upload',
  authMiddleware,
  express.raw({ type: 'multipart/form-data', limit: `${MAX_UPLOAD_MB}mb` }),
  async (req, res) => {
    const user = (req as any).user as { email: string }
    try {
      const userRoot = getUserRoot(user.email)
      await ensureDir(userRoot)

      const relDir = (req.query.path as string | undefined) || ''
      const dirAbs = resolveUnderUserRoot(userRoot, relDir)
      await ensureDir(dirAbs)

      const body = (req as any).body as Buffer
      const { filename, data } = parseMultipartSingleFile(body, req.headers['content-type'])
      const fileAbs = resolveUnderUserRoot(userRoot, (relDir ? relDir + '/' : '') + filename)

      await fsp.writeFile(fileAbs, data)

      res.json({ success: true, name: filename, size: data.length })
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Upload failed' })
    }
  }
)

app.get('/api/files/download', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const rel = (req.query.path as string | undefined) || ''
  try {
    const userRoot = getUserRoot(user.email)
    const abs = resolveUnderUserRoot(userRoot, rel)
    const st = await fsp.stat(abs)
    if (!st.isFile()) return res.status(400).json({ error: 'Not a file' })
    res.download(abs)
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Download failed' })
  }
})

app.delete('/api/files/item', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const rel = (req.query.path as string | undefined) || ''
  try {
    const userRoot = getUserRoot(user.email)
    const abs = resolveUnderUserRoot(userRoot, rel)

    // Prevent deleting user root itself
    if (abs === path.resolve(userRoot)) {
      return res.status(400).json({ error: 'Refusing to delete root' })
    }

    await fsp.rm(abs, { recursive: true, force: true })
    res.json({ success: true })
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Delete failed' })
  }
})

// Move file/folder
app.post('/api/files/move', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const { sourcePath, destFolder } = req.body
  
  if (!sourcePath) {
    return res.status(400).json({ error: 'sourcePath required' })
  }
  
  try {
    const userRoot = getUserRoot(user.email)
    const sourceAbs = resolveUnderUserRoot(userRoot, sourcePath)
    const sourceName = path.basename(sourceAbs)
    
    // Destination is the folder + source filename
    const destPath = destFolder ? `${destFolder}/${sourceName}` : sourceName
    const destAbs = resolveUnderUserRoot(userRoot, destPath)
    
    // Prevent moving to same location
    if (sourceAbs === destAbs) {
      return res.status(400).json({ error: 'Source and destination are the same' })
    }
    
    // Prevent moving into itself (for folders)
    if (destAbs.startsWith(sourceAbs + path.sep)) {
      return res.status(400).json({ error: 'Cannot move folder into itself' })
    }
    
    // Check if destination already exists
    if (existsSync(destAbs)) {
      return res.status(400).json({ error: 'Destination already exists' })
    }
    
    // Ensure destination directory exists
    await fsp.mkdir(path.dirname(destAbs), { recursive: true })
    
    // Move the file/folder
    await fsp.rename(sourceAbs, destAbs)
    
    res.json({ success: true, newPath: destPath })
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Move failed' })
  }
})


// Reminders endpoints
app.get('/api/reminders', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const status = (req.query.status as string | undefined) || 'open'

  const reminders = await loadReminders(user.email)

  let filtered = reminders
  if (status === 'open') filtered = reminders.filter(r => r.status === 'open')
  else if (status === 'done') filtered = reminders.filter(r => r.status === 'done')

  // Sort: open first, then by dueAt, then updatedAt desc
  filtered = filtered.slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    const da = Date.parse(a.dueAt || '') || 0
    const db = Date.parse(b.dueAt || '') || 0
    if (da !== db) return da - db
    return (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0)
  })

  res.json({ reminders: filtered })
})

app.post('/api/reminders', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const { title, body, dueAt, tags } = req.body as { title?: string; body?: string; dueAt?: string; tags?: string[] }
  if (!title) return res.status(400).json({ error: 'Title required' })

  const now = new Date().toISOString()
  const reminder: Reminder = {
    id: uuidv4(),
    title,
    body: body || undefined,
    dueAt: dueAt || now,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    tags: Array.isArray(tags) ? tags : undefined,
  }

  const reminders = await loadReminders(user.email)
  reminders.push(reminder)
  await saveReminders(user.email, reminders)

  res.json({ reminder })
})

app.patch('/api/reminders/:id', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const { id } = req.params
  const { title, body, dueAt, status } = req.body as { title?: string; body?: string; dueAt?: string; status?: ReminderStatus }

  const reminders = await loadReminders(user.email)
  const r = reminders.find(x => x.id === id)
  if (!r) return res.status(404).json({ error: 'Reminder not found' })

  if (title !== undefined) r.title = title
  if (body !== undefined) r.body = body || undefined
  if (dueAt !== undefined) r.dueAt = dueAt
  if (status !== undefined) r.status = status
  r.updatedAt = new Date().toISOString()

  await saveReminders(user.email, reminders)
  res.json({ reminder: r })
})

app.delete('/api/reminders/:id', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const { id } = req.params

  const reminders = await loadReminders(user.email)
  const next = reminders.filter(r => r.id !== id)
  await saveReminders(user.email, next)

  res.json({ success: true })
})

// Internal (cron/service) endpoint
app.post('/api/internal/reminders', async (req, res) => {
  const secret = req.headers['x-internal-secret']
  if (!REMINDERS_INTERNAL_SECRET || secret !== REMINDERS_INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { email, title, body, dueAt, tags } = req.body as {
    email?: string
    title?: string
    body?: string
    dueAt?: string
    tags?: string[]
  }
  if (!email || !title) return res.status(400).json({ error: 'email and title required' })

  const now = new Date().toISOString()
  const reminders = await loadReminders(email)

  // Minimal upsert: update existing open reminder with same title+tags
  const existing = reminders.find(r => r.status === 'open' && r.title === title && sameTags(r.tags, tags))

  if (existing) {
    if (body !== undefined) existing.body = body || undefined
    if (dueAt !== undefined) existing.dueAt = dueAt
    existing.source = 'cron'
    existing.updatedAt = now
    await saveReminders(email, reminders)
    return res.json({ reminder: existing, updated: true })
  }

  const reminder: Reminder = {
    id: uuidv4(),
    title,
    body: body || undefined,
    dueAt: dueAt || now,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    source: 'cron',
    tags: Array.isArray(tags) ? tags : undefined,
  }

  reminders.push(reminder)
  await saveReminders(email, reminders)
  res.json({ reminder, created: true })
})

// ============================================================
// Cron Jobs (via clawdbot CLI)
// ============================================================
const execAsync = promisify(exec)

app.get('/api/cron', authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync('clawdbot cron list --json', { timeout: 10000 })
    const data = JSON.parse(stdout)
    res.json(data)
  } catch (e: any) {
    console.error('Cron list error:', e)
    res.status(500).json({ error: e?.message || 'Failed to fetch cron jobs' })
  }
})

// Toggle cron job enabled/disabled
app.patch('/api/cron/:id', authMiddleware, async (req, res) => {
  const { id } = req.params
  const { enabled } = req.body
  
  try {
    const enableFlag = enabled ? '--enable' : '--disable'
    await execAsync(`clawdbot cron update ${id} ${enableFlag}`, { timeout: 10000 })
    res.json({ success: true, enabled })
  } catch (e: any) {
    console.error('Cron update error:', e)
    res.status(500).json({ error: e?.message || 'Failed to update cron job' })
  }
})

// Delete cron job
app.delete('/api/cron/:id', authMiddleware, async (req, res) => {
  const { id } = req.params
  
  try {
    await execAsync(`clawdbot cron remove ${id}`, { timeout: 10000 })
    res.json({ success: true })
  } catch (e: any) {
    console.error('Cron delete error:', e)
    res.status(500).json({ error: e?.message || 'Failed to delete cron job' })
  }
})

// ============================================================
// Knowledge Base / Wiki
// ============================================================
const KNOWLEDGE_ROOT = '/home/ubuntu/clawd/knowledge'
const KNOWLEDGE_INTERNAL_SECRET = process.env.KNOWLEDGE_INTERNAL_SECRET || 'chatty-internal-secret'

interface KnowledgeArticle {
  id: string
  title: string
  content: string  // Markdown
  tags: string[]
  folder: string   // path like "docs/api" or "" for root
  author: string   // email or 'chatty'
  createdAt: string
  updatedAt: string
}

async function loadKnowledge(): Promise<KnowledgeArticle[]> {
  try {
    await ensureDir(KNOWLEDGE_ROOT)
    const files = await fsp.readdir(KNOWLEDGE_ROOT)
    const articles: KnowledgeArticle[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      try {
        const data = await fsp.readFile(path.join(KNOWLEDGE_ROOT, f), 'utf-8')
        articles.push(JSON.parse(data))
      } catch {}
    }
    return articles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

async function saveArticle(article: KnowledgeArticle) {
  await ensureDir(KNOWLEDGE_ROOT)
  await fsp.writeFile(
    path.join(KNOWLEDGE_ROOT, `${article.id}.json`),
    JSON.stringify(article, null, 2)
  )
}

async function deleteArticle(id: string) {
  const file = path.join(KNOWLEDGE_ROOT, `${id}.json`)
  if (existsSync(file)) {
    await fsp.unlink(file)
    return true
  }
  return false
}

// List all articles
app.get('/api/knowledge', authMiddleware, async (req, res) => {
  const articles = await loadKnowledge()
  res.json({ articles })
})

// Get single article
app.get('/api/knowledge/:id', authMiddleware, async (req, res) => {
  const articles = await loadKnowledge()
  const article = articles.find(a => a.id === req.params.id)
  if (!article) return res.status(404).json({ error: 'Article not found' })
  res.json({ article })
})

// Create article
app.post('/api/knowledge', authMiddleware, async (req, res) => {
  const { title, content, tags, folder } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' })

  const article: KnowledgeArticle = {
    id: uuidv4(),
    title: title.trim(),
    content: content || '',
    tags: Array.isArray(tags) ? tags : [],
    folder: (folder || '').trim().replace(/^\/+|\/+$/g, ''), // normalize: no leading/trailing slashes
    author: (req as any).user.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  await saveArticle(article)
  res.json({ article })
})

// Update article
app.put('/api/knowledge/:id', authMiddleware, async (req, res) => {
  const articles = await loadKnowledge()
  const article = articles.find(a => a.id === req.params.id)
  if (!article) return res.status(404).json({ error: 'Article not found' })

  const { title, content, tags, folder } = req.body
  if (title !== undefined) article.title = title.trim()
  if (content !== undefined) article.content = content
  if (tags !== undefined) article.tags = Array.isArray(tags) ? tags : []
  if (folder !== undefined) article.folder = folder.trim().replace(/^\/+|\/+$/g, '')
  article.updatedAt = new Date().toISOString()
  
  await saveArticle(article)
  res.json({ article })
})

// Delete article
app.delete('/api/knowledge/:id', authMiddleware, async (req, res) => {
  const deleted = await deleteArticle(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Article not found' })
  res.json({ success: true })
})

// Internal API for Chatty to create/update articles (no auth, uses internal secret)
app.post('/api/knowledge/internal', async (req, res) => {
  const { secret, title, content, tags, folder, id } = req.body
  if (secret !== KNOWLEDGE_INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' })
  }
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' })

  if (id) {
    // Update existing
    const articles = await loadKnowledge()
    const article = articles.find(a => a.id === id)
    if (article) {
      article.title = title.trim()
      if (content !== undefined) article.content = content
      if (tags !== undefined) article.tags = Array.isArray(tags) ? tags : []
      if (folder !== undefined) article.folder = folder.trim().replace(/^\/+|\/+$/g, '')
      article.updatedAt = new Date().toISOString()
      await saveArticle(article)
      return res.json({ article, updated: true })
    }
  }

  // Create new
  const article: KnowledgeArticle = {
    id: id || uuidv4(),
    title: title.trim(),
    content: content || '',
    tags: Array.isArray(tags) ? tags : [],
    folder: (folder || '').trim().replace(/^\/+|\/+$/g, ''),
    author: 'chatty',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  await saveArticle(article)
  res.json({ article, created: true })
})

// Activity feed endpoint
app.get('/api/activity', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    
    if (!existsSync(ACTIVITY_LOG_FILE)) {
      return res.json({ activities: [] })
    }
    
    const content = await fsp.readFile(ACTIVITY_LOG_FILE, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    
    // Parse and get last N entries
    const activities = lines
      .map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .slice(-limit)
      .reverse() // Most recent first
    
    res.json({ activities })
  } catch (e: any) {
    console.error('Activity fetch error:', e)
    res.status(500).json({ error: e?.message || 'Failed to fetch activities' })
  }
})

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`🚀 Chatty Cockpit API on port ${PORT}`))
