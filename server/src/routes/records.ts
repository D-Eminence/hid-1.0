import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'

const router = Router()

// ── GET /api/records ──────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('medical_records').select('*')
    .order('created_at', { ascending: false })
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data ?? [])
})

// ── POST /api/records ─────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { hid_code, title, record, created_by } = req.body
  if (!hid_code || !record) {
    res.status(400).json({ error: 'hid_code and record are required' }); return
  }

  // Log access
  await supabase.from('access_logs').insert({
    hid_code: hid_code.toUpperCase(),
    accessed_by: created_by || 'Unknown',
    access_type: 'standard'
  })

  const { data, error } = await supabase.from('medical_records').insert({
    hid_code: hid_code.toUpperCase(),
    title: title?.trim() || 'Medical Record',
    record: record.trim(),
    created_by: (created_by || 'Unknown').trim()
  }).select().single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ success: true, record: data })
})

// ── DELETE /api/records/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const { error } = await supabase.from('medical_records').delete().eq('id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ success: true })
})

export default router
