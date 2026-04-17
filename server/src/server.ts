import express from 'express'
import path from 'path'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import * as Sentry from '@sentry/node'
import patientRoutes from './routes/patients'
import recordRoutes from './routes/records'
import logRoutes from './routes/logs'
import { isConfigured } from './lib/supabase'

const app  = express()
const PORT = process.env.PORT ?? 3000
const isProd = process.env.NODE_ENV === 'production'
const sentryCompat = Sentry as typeof Sentry & {
  Handlers?: {
    errorHandler?: () => express.ErrorRequestHandler
    requestHandler?: () => express.RequestHandler
  }
}

// ── Sentry (error monitoring) ─────────────────────────────────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development' })
  const requestHandler = sentryCompat.Handlers?.requestHandler?.()
  if (requestHandler) {
    app.use(requestHandler)
  }
}

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 })
app.use('/api', limiter)

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')))

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/patients', patientRoutes)
app.use('/api/records',  recordRoutes)
app.use('/api/logs',     logRoutes)

// ── Dashboard stats ───────────────────────────────────────────────────────────
app.get('/api/stats', async (_req, res) => {
  const { supabase } = await import('./lib/supabase')
  const [p, r, l] = await Promise.all([
    supabase.from('patients').select('id', { count: 'exact', head: true }),
    supabase.from('medical_records').select('id', { count: 'exact', head: true }),
    supabase.from('access_logs').select('id', { count: 'exact', head: true }),
  ])
  res.json({ patients: p.count ?? 0, records: r.count ?? 0, logs: l.count ?? 0 })
})

// ── Health check (UptimeRobot) ────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', configured: isConfigured, ts: new Date().toISOString() })
})

// ── React SPA (admin/dashboard) ───────────────────────────────────────────────
const appBuild = path.join(__dirname, '..', 'public', 'app')
app.use('/app-assets', express.static(appBuild))
const appIndex = path.join(appBuild, 'index.html')

// The legacy server no longer ships separate view templates.
app.get('/', (_req, res) => res.sendFile(appIndex))
app.get('/signup', (_req, res) => res.sendFile(appIndex))
app.get('/app', (_req, res) => res.redirect('/app/'))
app.get('/app/*', (_req, res) => res.sendFile(appIndex))

// ── Sentry error handler ──────────────────────────────────────────────────────
if (process.env.SENTRY_DSN) {
  const errorHandler = sentryCompat.Handlers?.errorHandler?.()
  if (errorHandler) {
    app.use(errorHandler)
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  HID legacy compatibility server → http://localhost:${PORT}`)
  console.log(`   Note        : The active app backend is Supabase, not this Express server`)
  console.log(`   Landing     : http://localhost:${PORT}/`)
  console.log(`   Signup      : http://localhost:${PORT}/signup`)
  console.log(`   Dashboard   : http://localhost:${PORT}/app`)
  console.log(`   Health      : http://localhost:${PORT}/health`)
  console.log(`   Supabase    : ${isConfigured ? '✓ Connected' : '⚠ Not configured'}`)
  console.log(`   Sentry      : ${process.env.SENTRY_DSN ? '✓ Active' : '— Not configured'}`)
  console.log(`   Resend      : ${process.env.RESEND_API_KEY ? '✓ Active' : '— Not configured'}\n`)
})

export default app
