import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import { v4 as uuidv4 } from 'uuid'
import { config } from 'dotenv'
import { exec } from 'child_process'
import { promisify } from 'util'

config()

const app = express()
app.use(cors())
app.use(express.json())

const JWT_SECRET = process.env.JWT_SECRET || 'chatty-cockpit-secret-change-me'
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || 'phofmann@delta-mind.at').split(',')
const APP_URL = process.env.APP_URL || 'https://app.chatty.delta-mind.at'

// In-memory store for magic link tokens (use Redis/DB in production)
const magicTokens = new Map<string, { email: string; expires: number }>()

// Email transporter
const transporter = nodemailer.createTransport({
  host: 'localhost',
  port: 25,
  secure: false,
  tls: { rejectUnauthorized: false }
})

// Auth: Request Magic Link
app.post('/api/auth/magic-link', async (req, res) => {
  const { email } = req.body
  
  if (!email || !ALLOWED_EMAILS.includes(email.toLowerCase())) {
    return res.status(403).json({ error: 'Email not allowed' })
  }
  
  const token = uuidv4()
  const expires = Date.now() + 15 * 60 * 1000 // 15 minutes
  
  magicTokens.set(token, { email: email.toLowerCase(), expires })
  
  const magicLink = `${APP_URL}/auth/verify?token=${token}`
  
  try {
    await transporter.sendMail({
      from: '"Chatty Cockpit" <chatty@chatty.delta-mind.at>',
      to: email,
      subject: '🔐 Dein Magic Link fürs Cockpit',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #e94560;">Hey! 👋</h2>
          <p>Hier ist dein Magic Link zum Chatty Cockpit:</p>
          <a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background: #e94560; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">
            Jetzt anmelden
          </a>
          <p style="color: #666; font-size: 14px;">
            Der Link ist 15 Minuten gültig.<br>
            Wenn du das nicht warst, ignoriere diese Email einfach.
          </p>
          <p style="color: #999; font-size: 12px;">— Chatty 💬</p>
        </div>
      `
    })
    
    res.json({ success: true })
  } catch (err) {
    console.error('Email error:', err)
    res.status(500).json({ error: 'Failed to send email' })
  }
})

// Auth: Verify Magic Link
app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body
  
  const data = magicTokens.get(token)
  
  if (!data) {
    return res.status(401).json({ error: 'Invalid token' })
  }
  
  if (Date.now() > data.expires) {
    magicTokens.delete(token)
    return res.status(401).json({ error: 'Token expired' })
  }
  
  magicTokens.delete(token)
  
  const jwtToken = jwt.sign({ email: data.email }, JWT_SECRET, { expiresIn: '7d' })
  
  res.json({ token: jwtToken, email: data.email })
})

// Auth middleware
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  try {
    const token = authHeader.slice(7)
    const decoded = jwt.verify(token, JWT_SECRET) as { email: string }
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// Chat: Send message to Chatty (via Clawdbot)
app.post('/api/chat/message', authMiddleware, async (req, res) => {
  const { message } = req.body
  const user = (req as any).user
  
  if (!message) {
    return res.status(400).json({ error: 'Message required' })
  }
  
  try {
    // Send message to Clawdbot via sessions_send or direct gateway API
    const execAsync = promisify(exec)
    
    // For now, use a simple approach - call clawdbot CLI
    // In production, use the Gateway WebSocket API
    const escapedMessage = message.replace(/'/g, "'\\''")
    const { stdout } = await execAsync(
      `echo '${escapedMessage}' | timeout 60 clawdbot chat --session cockpit-${user.email.replace('@', '-at-')} --no-interactive 2>/dev/null || echo "Entschuldige, ich konnte gerade nicht antworten."`,
      { maxBuffer: 1024 * 1024 }
    )
    
    res.json({ message: stdout.trim() || 'Ich hab deine Nachricht erhalten! 💬' })
  } catch (err) {
    console.error('Chat error:', err)
    res.json({ message: 'Entschuldige, da ist etwas schiefgelaufen. Probier es nochmal! 🔄' })
  }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`🚀 Chatty Cockpit API running on port ${PORT}`)
})
