import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import Imap from 'imap'
import { v4 as uuidv4 } from 'uuid'
import { config } from 'dotenv'
import path from 'path'
import os from 'os'
import { readFileSync, writeFileSync, existsSync, promises as fsp } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'

config()

const app = express()
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
})

// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) return next(new Error('Authentication required'))
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { email: string }
    socket.data.user = decoded
    next()
  } catch {
    next(new Error('Invalid token'))
  }
})

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.data.user?.email}`)
  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.data.user?.email}`)
  })
})
app.use(cors())
app.use(express.json())

const JWT_SECRET = process.env.JWT_SECRET || 'chatty-cockpit-secret-change-me'
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || 'phofmann@delta-mind.at').split(',')
const APP_URL = process.env.APP_URL || 'https://chatty.office.or.at'
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
      from: '"Chatty Cockpit" <chatty@office.or.at>',
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

  // Emit WebSocket event for real-time updates
  io.emit('kanban:task:created', { task })

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

  // Emit WebSocket event for real-time updates
  io.emit('kanban:task:updated', { task })

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

  // Emit WebSocket event for real-time updates
  io.emit('kanban:task:deleted', { id })

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

// ============================================================
// Password Manager
// ============================================================
const PASSWORDS_FILE = path.join(os.homedir(), '.config', 'chatty', 'passwords.json')
const PASSWORDS_SESSION_EXPIRY = 5 * 60 * 1000 // 5 minutes

interface PasswordEntry {
  id: string
  name: string
  username: string
  password: string // Encrypted
  url?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

interface PasswordVault {
  salt: string
  iv: string
  authTag: string
  encryptedData: string
  masterPasswordHash: string // For verification
}

// Session storage for unlocked vaults (in-memory, keyed by user email)
const passwordSessions = new Map<string, { key: Buffer; expiresAt: number }>()

async function ensurePasswordsDir() {
  const dir = path.dirname(PASSWORDS_FILE)
  await fsp.mkdir(dir, { recursive: true })
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
}

function encryptData(data: string, key: Buffer): { iv: string; authTag: string; encrypted: string } {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(data, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encrypted
  }
}

function decryptData(encrypted: string, key: Buffer, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(authTag, 'hex'))
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function hashMasterPassword(password: string, salt: Buffer): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
}

async function loadPasswordVault(): Promise<PasswordVault | null> {
  try {
    if (existsSync(PASSWORDS_FILE)) {
      return JSON.parse(await fsp.readFile(PASSWORDS_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load password vault:', e)
  }
  return null
}

async function savePasswordVault(vault: PasswordVault) {
  await ensurePasswordsDir()
  await fsp.writeFile(PASSWORDS_FILE, JSON.stringify(vault, null, 2))
}

function getPasswordSession(email: string): Buffer | null {
  const session = passwordSessions.get(email)
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    passwordSessions.delete(email)
    return null
  }
  return session.key
}

function setPasswordSession(email: string, key: Buffer) {
  passwordSessions.set(email, {
    key,
    expiresAt: Date.now() + PASSWORDS_SESSION_EXPIRY
  })
}

function clearPasswordSession(email: string) {
  passwordSessions.delete(email)
}

// Check if vault is set up
app.get('/api/passwords/status', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const vault = await loadPasswordVault()
  const session = getPasswordSession(user.email)

  res.json({
    isSetup: !!vault,
    isUnlocked: !!session
  })
})

// Setup master password (first time)
app.post('/api/passwords/setup', authMiddleware, async (req, res) => {
  const { masterPassword } = req.body

  if (!masterPassword || masterPassword.length < 8) {
    return res.status(400).json({ error: 'Master password must be at least 8 characters' })
  }

  const existingVault = await loadPasswordVault()
  if (existingVault) {
    return res.status(400).json({ error: 'Vault already exists' })
  }

  const salt = crypto.randomBytes(32)
  const key = deriveKey(masterPassword, salt)
  const masterPasswordHash = hashMasterPassword(masterPassword, salt)

  // Encrypt empty array as initial data
  const { iv, authTag, encrypted } = encryptData(JSON.stringify([]), key)

  const vault: PasswordVault = {
    salt: salt.toString('hex'),
    iv,
    authTag,
    encryptedData: encrypted,
    masterPasswordHash
  }

  await savePasswordVault(vault)

  // Auto-unlock after setup
  const user = (req as any).user as { email: string }
  setPasswordSession(user.email, key)

  res.json({ success: true })
})

// Unlock vault
app.post('/api/passwords/unlock', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const { masterPassword } = req.body

  if (!masterPassword) {
    return res.status(400).json({ error: 'Master password required' })
  }

  const vault = await loadPasswordVault()
  if (!vault) {
    return res.status(400).json({ error: 'Vault not set up' })
  }

  const salt = Buffer.from(vault.salt, 'hex')
  const providedHash = hashMasterPassword(masterPassword, salt)

  if (providedHash !== vault.masterPasswordHash) {
    return res.status(401).json({ error: 'Invalid master password' })
  }

  const key = deriveKey(masterPassword, salt)
  setPasswordSession(user.email, key)

  res.json({ success: true })
})

// Lock vault
app.post('/api/passwords/lock', authMiddleware, (req, res) => {
  const user = (req as any).user as { email: string }
  clearPasswordSession(user.email)
  res.json({ success: true })
})

// List all passwords (without actual password values)
app.get('/api/passwords', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const key = getPasswordSession(user.email)

  if (!key) {
    return res.status(401).json({ error: 'Vault locked' })
  }

  const vault = await loadPasswordVault()
  if (!vault) {
    return res.status(400).json({ error: 'Vault not set up' })
  }

  try {
    const decrypted = decryptData(vault.encryptedData, key, vault.iv, vault.authTag)
    const entries: PasswordEntry[] = JSON.parse(decrypted)

    // Return without password field
    const safeEntries = entries.map(({ password, ...rest }) => rest)
    res.json({ entries: safeEntries })
  } catch (e) {
    clearPasswordSession(user.email)
    res.status(401).json({ error: 'Decryption failed' })
  }
})

// Get single password (with decrypted password)
app.get('/api/passwords/:id', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const key = getPasswordSession(user.email)

  if (!key) {
    return res.status(401).json({ error: 'Vault locked' })
  }

  const vault = await loadPasswordVault()
  if (!vault) {
    return res.status(400).json({ error: 'Vault not set up' })
  }

  try {
    const decrypted = decryptData(vault.encryptedData, key, vault.iv, vault.authTag)
    const entries: PasswordEntry[] = JSON.parse(decrypted)
    const entry = entries.find(e => e.id === req.params.id)

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' })
    }

    res.json({ entry })
  } catch (e) {
    clearPasswordSession(user.email)
    res.status(401).json({ error: 'Decryption failed' })
  }
})

// Create new password entry
app.post('/api/passwords', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const key = getPasswordSession(user.email)

  if (!key) {
    return res.status(401).json({ error: 'Vault locked' })
  }

  const { name, username, password, url, notes } = req.body

  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password required' })
  }

  const vault = await loadPasswordVault()
  if (!vault) {
    return res.status(400).json({ error: 'Vault not set up' })
  }

  try {
    const decrypted = decryptData(vault.encryptedData, key, vault.iv, vault.authTag)
    const entries: PasswordEntry[] = JSON.parse(decrypted)

    const now = new Date().toISOString()
    const newEntry: PasswordEntry = {
      id: uuidv4(),
      name,
      username: username || '',
      password,
      url: url || undefined,
      notes: notes || undefined,
      createdAt: now,
      updatedAt: now
    }

    entries.push(newEntry)

    // Re-encrypt
    const { iv, authTag, encrypted } = encryptData(JSON.stringify(entries), key)
    vault.iv = iv
    vault.authTag = authTag
    vault.encryptedData = encrypted

    await savePasswordVault(vault)

    // Return without password
    const { password: _, ...safeEntry } = newEntry
    res.json({ entry: safeEntry })
  } catch (e) {
    clearPasswordSession(user.email)
    res.status(401).json({ error: 'Encryption failed' })
  }
})

// Update password entry
app.put('/api/passwords/:id', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const key = getPasswordSession(user.email)

  if (!key) {
    return res.status(401).json({ error: 'Vault locked' })
  }

  const { name, username, password, url, notes } = req.body

  const vault = await loadPasswordVault()
  if (!vault) {
    return res.status(400).json({ error: 'Vault not set up' })
  }

  try {
    const decrypted = decryptData(vault.encryptedData, key, vault.iv, vault.authTag)
    const entries: PasswordEntry[] = JSON.parse(decrypted)
    const entryIndex = entries.findIndex(e => e.id === req.params.id)

    if (entryIndex === -1) {
      return res.status(404).json({ error: 'Entry not found' })
    }

    const entry = entries[entryIndex]
    if (name !== undefined) entry.name = name
    if (username !== undefined) entry.username = username
    if (password !== undefined) entry.password = password
    if (url !== undefined) entry.url = url || undefined
    if (notes !== undefined) entry.notes = notes || undefined
    entry.updatedAt = new Date().toISOString()

    // Re-encrypt
    const { iv, authTag, encrypted } = encryptData(JSON.stringify(entries), key)
    vault.iv = iv
    vault.authTag = authTag
    vault.encryptedData = encrypted

    await savePasswordVault(vault)

    // Return without password
    const { password: _, ...safeEntry } = entry
    res.json({ entry: safeEntry })
  } catch (e) {
    clearPasswordSession(user.email)
    res.status(401).json({ error: 'Encryption failed' })
  }
})

// Delete password entry
app.delete('/api/passwords/:id', authMiddleware, async (req, res) => {
  const user = (req as any).user as { email: string }
  const key = getPasswordSession(user.email)

  if (!key) {
    return res.status(401).json({ error: 'Vault locked' })
  }

  const vault = await loadPasswordVault()
  if (!vault) {
    return res.status(400).json({ error: 'Vault not set up' })
  }

  try {
    const decrypted = decryptData(vault.encryptedData, key, vault.iv, vault.authTag)
    let entries: PasswordEntry[] = JSON.parse(decrypted)
    const initialLength = entries.length
    entries = entries.filter(e => e.id !== req.params.id)

    if (entries.length === initialLength) {
      return res.status(404).json({ error: 'Entry not found' })
    }

    // Re-encrypt
    const { iv, authTag, encrypted } = encryptData(JSON.stringify(entries), key)
    vault.iv = iv
    vault.authTag = authTag
    vault.encryptedData = encrypted

    await savePasswordVault(vault)

    res.json({ success: true })
  } catch (e) {
    clearPasswordSession(user.email)
    res.status(401).json({ error: 'Encryption failed' })
  }
})

// Generate random password
app.post('/api/passwords/generate', authMiddleware, (req, res) => {
  const { length = 16, includeSymbols = true, includeNumbers = true, includeUppercase = true } = req.body

  const passwordLength = Math.min(Math.max(parseInt(length) || 16, 8), 128)

  let charset = 'abcdefghijklmnopqrstuvwxyz'
  if (includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (includeNumbers) charset += '0123456789'
  if (includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?'

  const randomBytes = crypto.randomBytes(passwordLength)
  let password = ''
  for (let i = 0; i < passwordLength; i++) {
    password += charset[randomBytes[i] % charset.length]
  }

  res.json({ password })
})

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => console.log(`🚀 Chatty Cockpit API on port ${PORT} (WebSocket enabled)`))

// ============================================================
// Monitoring (Certificates & Health Checks)
// ============================================================
const MONITORING_FILE = '/home/ubuntu/clawd/monitoring.json'
const NOTES_FILE = '/home/ubuntu/clawd/notes.json'
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'phofmann@delta-mind.at'

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

interface HealthCheckItem {
  id: string
  url: string
  name?: string
  lastCheck?: string
  lastStatus?: number
  lastResponseTime?: number
  status: 'up' | 'down' | 'pending'
  error?: string
  history?: { ts: string; up: boolean }[]
}

interface MonitoringData {
  certs: CertCheck[]
  health: HealthCheckItem[]
}

function loadMonitoring(): MonitoringData {
  try {
    if (existsSync(MONITORING_FILE)) {
      return JSON.parse(readFileSync(MONITORING_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load monitoring:', e)
  }
  return { certs: [], health: [] }
}

function saveMonitoring(data: MonitoringData) {
  writeFileSync(MONITORING_FILE, JSON.stringify(data, null, 2))
}

// Check SSL certificate
async function checkCertificate(url: string): Promise<Partial<CertCheck>> {
  const https = await import('https')
  const { URL } = await import('url')
  
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url)
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        method: 'GET',
        rejectUnauthorized: false, // We want to check even expired certs
        timeout: 10000
      }

      const req = https.request(options, (res) => {
        const cert = (res.socket as any).getPeerCertificate()
        if (!cert || !cert.valid_to) {
          resolve({ status: 'error', error: 'Kein Zertifikat gefunden' })
          return
        }

        const validTo = new Date(cert.valid_to)
        const validFrom = new Date(cert.valid_from)
        const now = new Date()
        const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        let status: 'ok' | 'warning' | 'error' = 'ok'
        if (daysUntilExpiry <= 0) status = 'error'
        else if (daysUntilExpiry <= 30) status = 'warning'

        resolve({
          status,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          daysUntilExpiry,
          issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown',
          lastCheck: new Date().toISOString()
        })
      })

      req.on('error', (e) => {
        resolve({ status: 'error', error: e.message, lastCheck: new Date().toISOString() })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ status: 'error', error: 'Timeout', lastCheck: new Date().toISOString() })
      })

      req.end()
    } catch (e: any) {
      resolve({ status: 'error', error: e.message, lastCheck: new Date().toISOString() })
    }
  })
}

// Check health endpoint
async function checkHealth(url: string): Promise<Partial<HealthCheckItem>> {
  const startTime = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(url, { 
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Chatty-Cockpit-Monitor/1.0' }
    })
    
    clearTimeout(timeout)
    const responseTime = Date.now() - startTime

    return {
      status: res.ok ? 'up' : 'down',
      lastStatus: res.status,
      lastResponseTime: responseTime,
      lastCheck: new Date().toISOString(),
      error: res.ok ? undefined : `HTTP ${res.status}`
    }
  } catch (e: any) {
    return {
      status: 'down',
      lastCheck: new Date().toISOString(),
      lastResponseTime: Date.now() - startTime,
      error: e.name === 'AbortError' ? 'Timeout' : e.message
    }
  }
}

// Send alert email
async function sendAlertEmail(subject: string, body: string) {
  try {
    await transporter.sendMail({
      from: '"Chatty Monitor" <chatty@office.or.at>',
      to: ALERT_EMAIL,
      subject,
      html: body
    })
  } catch (e) {
    console.error('Failed to send alert email:', e)
  }
}

// Certificate endpoints
app.get('/api/monitoring/certs', authMiddleware, (req, res) => {
  const data = loadMonitoring()
  res.json({ certs: data.certs })
})

app.post('/api/monitoring/certs', authMiddleware, async (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'URL required' })

  const data = loadMonitoring()
  
  // Check if already exists
  if (data.certs.some(c => c.url === url)) {
    return res.status(400).json({ error: 'URL already monitored' })
  }

  const check: CertCheck = {
    id: uuidv4(),
    url,
    status: 'pending'
  }

  // Run initial check
  const result = await checkCertificate(url)
  Object.assign(check, result)

  data.certs.push(check)
  saveMonitoring(data)

  res.json({ check })
})

app.delete('/api/monitoring/certs/:id', authMiddleware, (req, res) => {
  const data = loadMonitoring()
  data.certs = data.certs.filter(c => c.id !== req.params.id)
  saveMonitoring(data)
  res.json({ success: true })
})

app.post('/api/monitoring/certs/check-all', authMiddleware, async (req, res) => {
  const data = loadMonitoring()
  
  for (const check of data.certs) {
    const result = await checkCertificate(check.url)
    Object.assign(check, result)
  }
  
  saveMonitoring(data)
  res.json({ certs: data.certs })
})

// Health check endpoints
app.get('/api/monitoring/health', authMiddleware, (req, res) => {
  const data = loadMonitoring()
  
  // Calculate uptime percentage
  const checks = data.health.map(h => {
    if (h.history && h.history.length > 0) {
      const upCount = h.history.filter(e => e.up).length
      h.uptimePercent = (upCount / h.history.length) * 100
    }
    return h
  })
  
  res.json({ check: checks })
})

app.post('/api/monitoring/health', authMiddleware, async (req, res) => {
  const { url, name } = req.body
  if (!url) return res.status(400).json({ error: 'URL required' })

  const data = loadMonitoring()
  
  if (data.health.some(h => h.url === url)) {
    return res.status(400).json({ error: 'URL already monitored' })
  }

  const check: HealthCheckItem = {
    id: uuidv4(),
    url,
    name,
    status: 'pending',
    history: []
  }

  // Run initial check
  const result = await checkHealth(url)
  Object.assign(check, result)
  check.history = [{ ts: new Date().toISOString(), up: result.status === 'up' }]

  data.health.push(check)
  saveMonitoring(data)

  res.json({ check })
})

app.delete('/api/monitoring/health/:id', authMiddleware, (req, res) => {
  const data = loadMonitoring()
  data.health = data.health.filter(h => h.id !== req.params.id)
  saveMonitoring(data)
  res.json({ success: true })
})

app.post('/api/monitoring/health/check-all', authMiddleware, async (req, res) => {
  const data = loadMonitoring()
  const alerts: string[] = []
  
  for (const check of data.health) {
    const prevStatus = check.status
    const result = await checkHealth(check.url)
    Object.assign(check, result)
    
    // Add to history (keep last 1000 entries)
    if (!check.history) check.history = []
    check.history.push({ ts: new Date().toISOString(), up: result.status === 'up' })
    if (check.history.length > 1000) check.history = check.history.slice(-1000)
    
    // Check for status change
    if (prevStatus === 'up' && result.status === 'down') {
      alerts.push(`🔴 ${check.name || check.url} ist DOWN: ${result.error}`)
    } else if (prevStatus === 'down' && result.status === 'up') {
      alerts.push(`🟢 ${check.name || check.url} ist wieder UP`)
    }
  }
  
  // Send alert email if any status changed
  if (alerts.length > 0) {
    const subject = alerts.some(a => a.includes('DOWN')) 
      ? '🚨 Health Check Alert - Site DOWN' 
      : '✅ Health Check - Site Recovered'
    
    await sendAlertEmail(subject, `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2 style="color: ${alerts.some(a => a.includes('DOWN')) ? '#e94560' : '#10b981'};">
          Health Check Status Update
        </h2>
        <ul style="line-height: 1.8;">
          ${alerts.map(a => `<li>${a}</li>`).join('')}
        </ul>
        <p style="color: #666; margin-top: 20px;">
          <a href="https://chatty.office.or.at/monitoring">Zum Cockpit →</a>
        </p>
      </div>
    `)
  }
  
  saveMonitoring(data)
  res.json({ health: data.health, alerts })
})

// Internal endpoint for cron jobs
app.post('/api/monitoring/cron/certs', async (req, res) => {
  const secret = req.headers['x-internal-secret']
  if (!REMINDERS_INTERNAL_SECRET || secret !== REMINDERS_INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const data = loadMonitoring()
  const warnings: string[] = []
  
  for (const check of data.certs) {
    const result = await checkCertificate(check.url)
    Object.assign(check, result)
    
    if (result.daysUntilExpiry !== undefined && result.daysUntilExpiry <= 30) {
      warnings.push(`⚠️ ${check.url}: ${result.daysUntilExpiry} Tage bis Ablauf`)
    }
  }
  
  saveMonitoring(data)

  // Send warning email if any certs expiring soon
  if (warnings.length > 0) {
    await sendAlertEmail('⚠️ SSL Zertifikate laufen bald ab', `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2 style="color: #f59e0b;">SSL Zertifikat Warnung</h2>
        <ul style="line-height: 1.8;">
          ${warnings.map(w => `<li>${w}</li>`).join('')}
        </ul>
        <p style="color: #666; margin-top: 20px;">
          <a href="https://chatty.office.or.at/monitoring">Zum Cockpit →</a>
        </p>
      </div>
    `)
  }
  
  res.json({ checked: data.certs.length, warnings })
})

app.post('/api/monitoring/cron/health', async (req, res) => {
  const secret = req.headers['x-internal-secret']
  if (!REMINDERS_INTERNAL_SECRET || secret !== REMINDERS_INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Same as check-all but uses internal secret
  const data = loadMonitoring()
  const alerts: string[] = []

  for (const check of data.health) {
    const prevStatus = check.status
    const result = await checkHealth(check.url)
    Object.assign(check, result)

    if (!check.history) check.history = []
    check.history.push({ ts: new Date().toISOString(), up: result.status === 'up' })
    if (check.history.length > 1000) check.history = check.history.slice(-1000)

    if (prevStatus === 'up' && result.status === 'down') {
      alerts.push(`🔴 ${check.name || check.url} ist DOWN: ${result.error}`)
    } else if (prevStatus === 'down' && result.status === 'up') {
      alerts.push(`🟢 ${check.name || check.url} ist wieder UP`)
    }
  }

  if (alerts.length > 0) {
    const subject = alerts.some(a => a.includes('DOWN'))
      ? '🚨 Health Check Alert - Site DOWN'
      : '✅ Health Check - Site Recovered'

    await sendAlertEmail(subject, `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2 style="color: ${alerts.some(a => a.includes('DOWN')) ? '#e94560' : '#10b981'};">
          Health Check Status Update
        </h2>
        <ul style="line-height: 1.8;">
          ${alerts.map(a => `<li>${a}</li>`).join('')}
        </ul>
        <p style="color: #666; margin-top: 20px;">
          <a href="https://chatty.office.or.at/monitoring">Zum Cockpit →</a>
        </p>
      </div>
    `)
  }

  saveMonitoring(data)
  res.json({ checked: data.health.length, alerts })
})

// ============================================================
// Email Client (IMAP + SMTP)
// ============================================================
const EMAIL_CONFIG_FILE = path.join(os.homedir(), '.config', 'chatty', 'email.json')
const EMAIL_SERVER = 'office.or.at'
const IMAP_PORT = 993
const SMTP_PORT = 587

interface EmailConfig {
  user: string
  password: string
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

interface EmailFolder {
  name: string
  path: string
  unreadCount?: number
}

function loadEmailConfig(): EmailConfig | null {
  try {
    if (existsSync(EMAIL_CONFIG_FILE)) {
      return JSON.parse(readFileSync(EMAIL_CONFIG_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load email config:', e)
  }
  return null
}

function getImapConnection(): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const config = loadEmailConfig()
    if (!config) {
      reject(new Error('Email config not found at ~/.config/chatty/email.json'))
      return
    }

    const imap = new Imap({
      user: config.user,
      password: config.password,
      host: EMAIL_SERVER,
      port: IMAP_PORT,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    })

    imap.once('ready', () => resolve(imap))
    imap.once('error', (err: Error) => reject(err))
    imap.connect()
  })
}

function parseAddress(addr: any): { email: string; name?: string } {
  if (!addr || !addr[0]) return { email: '' }
  const a = addr[0]
  return {
    email: a.mailbox && a.host ? `${a.mailbox}@${a.host}` : '',
    name: a.name || undefined
  }
}

function decodeRFC2047(str: string): string {
  if (!str) return ''
  // Handle =?charset?encoding?text?= format
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(text, 'base64').toString('utf-8')
      } else if (encoding.toUpperCase() === 'Q') {
        return text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        )
      }
    } catch {}
    return text
  })
}

// Get email folders
app.get('/api/email/folders', authMiddleware, async (req, res) => {
  let imap: Imap | null = null
  try {
    imap = await getImapConnection()

    const folders: EmailFolder[] = await new Promise((resolve, reject) => {
      imap!.getBoxes((err, boxes) => {
        if (err) return reject(err)

        const result: EmailFolder[] = []

        function processBoxes(boxes: any, prefix = '') {
          for (const [name, box] of Object.entries(boxes as Record<string, any>)) {
            const fullPath = prefix ? `${prefix}${box.delimiter || '/'}${name}` : name
            result.push({ name, path: fullPath })
            if (box.children) {
              processBoxes(box.children, fullPath)
            }
          }
        }

        processBoxes(boxes)
        resolve(result)
      })
    })

    // Get unread counts for common folders
    const commonFolders = ['INBOX', 'Sent', 'Drafts', 'Trash', 'Junk', 'Spam']
    for (const folder of folders) {
      if (commonFolders.some(f => folder.path.toUpperCase().includes(f.toUpperCase()))) {
        try {
          const box = await new Promise<any>((resolve, reject) => {
            imap!.openBox(folder.path, true, (err, box) => {
              if (err) reject(err)
              else resolve(box)
            })
          })
          folder.unreadCount = box.messages?.unseen || 0
        } catch {}
      }
    }

    imap.end()
    res.json({ folders })
  } catch (e: any) {
    if (imap) imap.end()
    console.error('Email folders error:', e)
    res.status(500).json({ error: e?.message || 'Failed to get folders' })
  }
})

// Get messages from a folder
app.get('/api/email/messages', authMiddleware, async (req, res) => {
  let imap: Imap | null = null
  try {
    const folder = (req.query.folder as string) || 'INBOX'
    const limit = parseInt(req.query.limit as string) || 50

    imap = await getImapConnection()

    const box = await new Promise<any>((resolve, reject) => {
      imap!.openBox(folder, true, (err, box) => {
        if (err) reject(err)
        else resolve(box)
      })
    })

    const total = box.messages.total
    if (total === 0) {
      imap.end()
      return res.json({ messages: [], total: 0 })
    }

    const start = Math.max(1, total - limit + 1)
    const range = `${start}:${total}`

    const messages: EmailMessage[] = await new Promise((resolve, reject) => {
      const msgs: EmailMessage[] = []
      const fetch = imap!.seq.fetch(range, {
        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
        struct: true
      })

      fetch.on('message', (msg, seqno) => {
        let uid = 0
        let header = ''
        let body = ''
        let flags: string[] = []

        msg.on('body', (stream, info) => {
          let buffer = ''
          stream.on('data', (chunk) => { buffer += chunk.toString('utf8') })
          stream.on('end', () => {
            if (info.which.includes('HEADER')) {
              header = buffer
            } else {
              body = buffer.slice(0, 200) // Preview only
            }
          })
        })

        msg.once('attributes', (attrs) => {
          uid = attrs.uid
          flags = attrs.flags || []
        })

        msg.once('end', () => {
          // Parse header
          const fromMatch = header.match(/From:\s*(.+?)(?:\r?\n(?!\s)|\r?\n$)/i)
          const toMatch = header.match(/To:\s*(.+?)(?:\r?\n(?!\s)|\r?\n$)/i)
          const subjectMatch = header.match(/Subject:\s*(.+?)(?:\r?\n(?!\s)|\r?\n$)/i)
          const dateMatch = header.match(/Date:\s*(.+?)(?:\r?\n(?!\s)|\r?\n$)/i)

          const fromRaw = fromMatch?.[1]?.trim() || ''
          const fromDecoded = decodeRFC2047(fromRaw)
          // Extract email and name from "Name <email>" format
          const emailMatch = fromDecoded.match(/<([^>]+)>/)
          const fromEmail = emailMatch ? emailMatch[1] : fromDecoded.replace(/[<>]/g, '').trim()
          const fromName = emailMatch ? fromDecoded.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g, '') : undefined

          msgs.push({
            id: `${folder}-${uid}`,
            uid,
            folder,
            from: fromEmail,
            fromName: fromName || undefined,
            to: decodeRFC2047(toMatch?.[1]?.trim() || ''),
            subject: decodeRFC2047(subjectMatch?.[1]?.trim() || '(Kein Betreff)'),
            date: dateMatch?.[1]?.trim() || new Date().toISOString(),
            preview: body.replace(/\s+/g, ' ').trim().slice(0, 150),
            seen: flags.includes('\\Seen'),
            flags
          })
        })
      })

      fetch.once('error', reject)
      fetch.once('end', () => {
        // Sort by date descending (newest first)
        msgs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        resolve(msgs)
      })
    })

    imap.end()
    res.json({ messages, total })
  } catch (e: any) {
    if (imap) imap.end()
    console.error('Email messages error:', e)
    res.status(500).json({ error: e?.message || 'Failed to get messages' })
  }
})

// Get single message with full body
app.get('/api/email/message/:id', authMiddleware, async (req, res) => {
  let imap: Imap | null = null
  try {
    const { id } = req.params
    const [folder, uidStr] = id.split(/-(?=\d+$)/)
    const uid = parseInt(uidStr)

    if (!folder || !uid) {
      return res.status(400).json({ error: 'Invalid message ID' })
    }

    imap = await getImapConnection()

    await new Promise<void>((resolve, reject) => {
      imap!.openBox(folder, true, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    const message: EmailMessage = await new Promise((resolve, reject) => {
      const fetch = imap!.fetch([uid], {
        bodies: ['HEADER', 'TEXT', ''],
        struct: true
      })

      let header = ''
      let body = ''
      let fullBody = ''
      let flags: string[] = []
      let msgUid = 0

      fetch.on('message', (msg) => {
        msg.on('body', (stream, info) => {
          let buffer = ''
          stream.on('data', (chunk) => { buffer += chunk.toString('utf8') })
          stream.on('end', () => {
            if (info.which === 'HEADER') {
              header = buffer
            } else if (info.which === 'TEXT') {
              body = buffer
            } else {
              fullBody = buffer
            }
          })
        })

        msg.once('attributes', (attrs) => {
          msgUid = attrs.uid
          flags = attrs.flags || []
        })
      })

      fetch.once('error', reject)
      fetch.once('end', () => {
        // Parse header
        const fromMatch = header.match(/From:\s*(.+?)(?:\r?\n(?!\s)|\r?\n$)/i)
        const toMatch = header.match(/To:\s*(.+?)(?:\r?\n(?!\s)|\r?\n$)/i)
        const subjectMatch = header.match(/Subject:\s*(.+?)(?:\r?\n(?!\s)|\r?\n$)/i)
        const dateMatch = header.match(/Date:\s*(.+?)(?:\r?\n(?!\s)|\r?\n$)/i)

        const fromRaw = fromMatch?.[1]?.trim() || ''
        const fromDecoded = decodeRFC2047(fromRaw)
        const emailMatch = fromDecoded.match(/<([^>]+)>/)
        const fromEmail = emailMatch ? emailMatch[1] : fromDecoded.replace(/[<>]/g, '').trim()
        const fromName = emailMatch ? fromDecoded.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g, '') : undefined

        // Try to extract HTML or plain text body
        let bodyText = body || fullBody
        let bodyHtml: string | undefined

        // Check for multipart content
        const boundaryMatch = header.match(/boundary="?([^"\r\n]+)"?/i)
        if (boundaryMatch) {
          const boundary = boundaryMatch[1]
          const parts = fullBody.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))

          for (const part of parts) {
            if (part.includes('Content-Type: text/html')) {
              const htmlStart = part.indexOf('\r\n\r\n') || part.indexOf('\n\n')
              if (htmlStart > -1) {
                bodyHtml = part.slice(htmlStart + 4).trim()
                // Handle quoted-printable
                if (part.includes('quoted-printable')) {
                  bodyHtml = bodyHtml.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) =>
                    String.fromCharCode(parseInt(hex, 16))
                  )
                }
                // Handle base64
                if (part.includes('base64')) {
                  try {
                    bodyHtml = Buffer.from(bodyHtml.replace(/\s/g, ''), 'base64').toString('utf-8')
                  } catch {}
                }
              }
            } else if (part.includes('Content-Type: text/plain') && !bodyText) {
              const textStart = part.indexOf('\r\n\r\n') || part.indexOf('\n\n')
              if (textStart > -1) {
                bodyText = part.slice(textStart + 4).trim()
              }
            }
          }
        }

        // Clean up body text
        if (!bodyHtml && bodyText) {
          // Handle quoted-printable
          bodyText = bodyText.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
          )
        }

        resolve({
          id,
          uid: msgUid,
          folder,
          from: fromEmail,
          fromName: fromName || undefined,
          to: decodeRFC2047(toMatch?.[1]?.trim() || ''),
          subject: decodeRFC2047(subjectMatch?.[1]?.trim() || '(Kein Betreff)'),
          date: dateMatch?.[1]?.trim() || new Date().toISOString(),
          preview: (bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 150),
          body: bodyText || undefined,
          bodyHtml: bodyHtml || undefined,
          seen: flags.includes('\\Seen'),
          flags
        })
      })
    })

    imap.end()
    res.json({ message })
  } catch (e: any) {
    if (imap) imap.end()
    console.error('Email message error:', e)
    res.status(500).json({ error: e?.message || 'Failed to get message' })
  }
})

// Send email
app.post('/api/email/send', authMiddleware, async (req, res) => {
  try {
    const { to, subject, body, replyTo } = req.body

    if (!to || !subject) {
      return res.status(400).json({ error: 'To and subject required' })
    }

    const config = loadEmailConfig()
    if (!config) {
      return res.status(500).json({ error: 'Email config not found' })
    }

    const smtpTransport = nodemailer.createTransport({
      host: EMAIL_SERVER,
      port: SMTP_PORT,
      secure: false,
      auth: {
        user: config.user,
        pass: config.password
      },
      tls: { rejectUnauthorized: false }
    })

    const mailOptions: any = {
      from: config.user,
      to,
      subject,
      text: body,
      html: body?.includes('<') ? body : undefined
    }

    if (replyTo) {
      mailOptions.inReplyTo = replyTo
      mailOptions.references = replyTo
    }

    await smtpTransport.sendMail(mailOptions)

    res.json({ success: true })
  } catch (e: any) {
    console.error('Email send error:', e)
    res.status(500).json({ error: e?.message || 'Failed to send email' })
  }
})

// Mark message as read
app.post('/api/email/mark-read/:id', authMiddleware, async (req, res) => {
  let imap: Imap | null = null
  try {
    const { id } = req.params
    const [folder, uidStr] = id.split(/-(?=\d+$)/)
    const uid = parseInt(uidStr)

    if (!folder || !uid) {
      return res.status(400).json({ error: 'Invalid message ID' })
    }

    imap = await getImapConnection()

    await new Promise<void>((resolve, reject) => {
      imap!.openBox(folder, false, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    await new Promise<void>((resolve, reject) => {
      imap!.addFlags([uid], ['\\Seen'], (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    imap.end()
    res.json({ success: true })
  } catch (e: any) {
    if (imap) imap.end()
    console.error('Email mark-read error:', e)
    res.status(500).json({ error: e?.message || 'Failed to mark as read' })
  }
})

// Mark message as unread
app.post('/api/email/mark-unread/:id', authMiddleware, async (req, res) => {
  let imap: Imap | null = null
  try {
    const { id } = req.params
    const [folder, uidStr] = id.split(/-(?=\d+$)/)
    const uid = parseInt(uidStr)

    if (!folder || !uid) {
      return res.status(400).json({ error: 'Invalid message ID' })
    }

    imap = await getImapConnection()

    await new Promise<void>((resolve, reject) => {
      imap!.openBox(folder, false, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    await new Promise<void>((resolve, reject) => {
      imap!.delFlags([uid], ['\\Seen'], (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    imap.end()
    res.json({ success: true })
  } catch (e: any) {
    if (imap) imap.end()
    console.error('Email mark-unread error:', e)
    res.status(500).json({ error: e?.message || 'Failed to mark as unread' })
  }
})

// Delete message (move to Trash or permanently delete)
app.delete('/api/email/message/:id', authMiddleware, async (req, res) => {
  let imap: Imap | null = null
  try {
    const { id } = req.params
    const [folder, uidStr] = id.split(/-(?=\d+$)/)
    const uid = parseInt(uidStr)

    if (!folder || !uid) {
      return res.status(400).json({ error: 'Invalid message ID' })
    }

    imap = await getImapConnection()

    await new Promise<void>((resolve, reject) => {
      imap!.openBox(folder, false, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    // Try to move to Trash, otherwise delete
    const trashFolders = ['Trash', 'Deleted', 'Papierkorb']
    let moved = false

    if (!trashFolders.some(t => folder.toLowerCase().includes(t.toLowerCase()))) {
      for (const trash of trashFolders) {
        try {
          await new Promise<void>((resolve, reject) => {
            imap!.move([uid], trash, (err) => {
              if (err) reject(err)
              else resolve()
            })
          })
          moved = true
          break
        } catch {}
      }
    }

    if (!moved) {
      // Permanently delete
      await new Promise<void>((resolve, reject) => {
        imap!.addFlags([uid], ['\\Deleted'], (err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      await new Promise<void>((resolve, reject) => {
        imap!.expunge((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }

    imap.end()
    res.json({ success: true, moved })
  } catch (e: any) {
    if (imap) imap.end()
    console.error('Email delete error:', e)
    res.status(500).json({ error: e?.message || 'Failed to delete message' })
  }
})

// ============================================================
// Notes
// ============================================================
interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
  createdBy: string
}

function loadNotes(): Note[] {
  try {
    if (existsSync(NOTES_FILE)) {
      return JSON.parse(readFileSync(NOTES_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load notes:', e)
  }
  return []
}

function saveNotes(notes: Note[]) {
  writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2))
}

// Get all notes
app.get('/api/notes', authMiddleware, (req, res) => {
  const notes = loadNotes()
  // Sort by updatedAt descending
  notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  res.json({ notes })
})

// Get single note
app.get('/api/notes/:id', authMiddleware, (req, res) => {
  const notes = loadNotes()
  const note = notes.find(n => n.id === req.params.id)
  if (!note) return res.status(404).json({ error: 'Note not found' })
  res.json({ note })
})

// Create note
app.post('/api/notes', authMiddleware, (req, res) => {
  const { title, content } = req.body
  const user = (req as any).user as { email: string }

  const now = new Date().toISOString()
  const note: Note = {
    id: uuidv4(),
    title: title?.trim() || 'Unbenannt',
    content: content || '',
    createdAt: now,
    updatedAt: now,
    createdBy: user.email
  }

  const notes = loadNotes()
  notes.push(note)
  saveNotes(notes)

  res.json({ note })
})

// Update note
app.put('/api/notes/:id', authMiddleware, (req, res) => {
  const { title, content } = req.body
  const notes = loadNotes()
  const note = notes.find(n => n.id === req.params.id)

  if (!note) return res.status(404).json({ error: 'Note not found' })

  if (title !== undefined) note.title = title.trim() || 'Unbenannt'
  if (content !== undefined) note.content = content
  note.updatedAt = new Date().toISOString()

  saveNotes(notes)
  res.json({ note })
})

// Delete note
app.delete('/api/notes/:id', authMiddleware, (req, res) => {
  const notes = loadNotes()
  const next = notes.filter(n => n.id !== req.params.id)

  if (next.length === notes.length) {
    return res.status(404).json({ error: 'Note not found' })
  }

  saveNotes(next)
  res.json({ success: true })
})
