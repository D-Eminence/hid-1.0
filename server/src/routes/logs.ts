import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('access_logs').select('*')
    .order('access_time', { ascending: false })
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data ?? [])
})

export default router
