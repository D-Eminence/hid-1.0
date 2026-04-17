import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { sendHIDEmail } from '../lib/resend'

const router = Router()

// Generate unique HID code
function genHID(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const seg = (n: number) => Array.from({length:n}, () => chars[Math.floor(Math.random()*chars.length)]).join('')
  return `HID-${seg(4)}-${seg(4)}-${seg(4)}`
}

// ── POST /api/patients/register ───────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  const { full_name, dob, blood_group, pin, email, phone, gender } = req.body

  if (!full_name || !blood_group) {
    res.status(400).json({ error: 'full_name and blood_group are required' })
    return
  }

  // Ensure unique HID (retry up to 5 times)
  let hid_code = ''
  for (let i = 0; i < 5; i++) {
    const candidate = genHID()
    const { data } = await supabase.from('patients').select('id').eq('hid_code', candidate).single()
    if (!data) { hid_code = candidate; break }
  }
  if (!hid_code) { res.status(500).json({ error: 'Could not generate unique HID' }); return }

  const { data, error } = await supabase.from('patients').insert({
    full_name: full_name.trim(),
    dob: dob || null,
    blood_group,
    hid_code,
    pin: pin || null,
    email: email?.trim() || null,
    phone: phone?.trim() || null,
    gender: gender || null,
  }).select().single()

  if (error) { res.status(500).json({ error: error.message }); return }

  // Send HID via email (non-blocking)
  if (email) {
    sendHIDEmail({ to: email, name: full_name, hidCode: hid_code })
      .catch(e => console.error('Email send failed:', e))
  }

  res.json({ success: true, patient: data, hid_code })
})

// ── GET /api/patients/:hid ────────────────────────────────────────────────────
router.get('/:hid', async (req: Request, res: Response) => {
  const { hid } = req.params
  const { pin } = req.query as { pin?: string }

  const { data: patient, error } = await supabase
    .from('patients').select('*')
    .eq('hid_code', hid.toUpperCase())
    .single()

  if (error || !patient) { res.status(404).json({ error: 'Patient not found' }); return }

  if (patient.pin && pin !== patient.pin) {
    res.status(401).json({ error: 'Incorrect PIN' }); return
  }

  const { data: records } = await supabase
    .from('medical_records').select('*')
    .eq('hid_code', hid.toUpperCase())
    .order('created_at', { ascending: false })

  res.json({ patient, records: records ?? [] })
})

// ── POST /api/patients/send-hid ───────────────────────────────────────────────
router.post('/send-hid', async (req: Request, res: Response) => {
  const { hidCode, email, name } = req.body
  if (!hidCode || !email || !name) {
    res.status(400).json({ error: 'hidCode, email and name required' }); return
  }
  const result = await sendHIDEmail({ to: email, name, hidCode })
  res.json(result)
})

export default router
