-- Outreach self-signup: INSERT policies + invite codes table + missing UPDATE policies

-- Allow any authenticated user to create a campaign (they become the admin)
DROP POLICY IF EXISTS "campaigns_insert_for_authenticated" ON hid_outreach_campaigns;
CREATE POLICY "campaigns_insert_for_authenticated" ON hid_outreach_campaigns
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow workers to insert their own worker record
DROP POLICY IF EXISTS "workers_insert_own" ON hid_outreach_workers;
CREATE POLICY "workers_insert_own" ON hid_outreach_workers
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());

-- Allow campaign workers to update their own encounters
DROP POLICY IF EXISTS "encounters_update_campaign_workers" ON hid_outreach_encounters;
CREATE POLICY "encounters_update_campaign_workers" ON hid_outreach_encounters
  FOR UPDATE TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

-- Allow campaign workers to update sync queue items (needed for markSyncQueueAsSynced)
DROP POLICY IF EXISTS "sync_queue_update_campaign_workers" ON hid_sync_queue;
CREATE POLICY "sync_queue_update_campaign_workers" ON hid_sync_queue
  FOR UPDATE TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

-- Invite codes table
CREATE TABLE IF NOT EXISTS hid_outreach_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES hid_outreach_campaigns(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES hid_outreach_workers(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'enumerator' CHECK (role IN ('enumerator', 'health_worker', 'admin')),
  max_uses INTEGER NOT NULL DEFAULT 50,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE hid_outreach_invites ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can read an invite by code — the code itself is the secret
DROP POLICY IF EXISTS "invites_select_public" ON hid_outreach_invites;
CREATE POLICY "invites_select_public" ON hid_outreach_invites
  FOR SELECT USING (true);

-- Campaign workers (admin) can create invites
DROP POLICY IF EXISTS "invites_insert_campaign_workers" ON hid_outreach_invites;
CREATE POLICY "invites_insert_campaign_workers" ON hid_outreach_invites
  FOR INSERT TO authenticated WITH CHECK (
    created_by IN (
      SELECT id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

-- Campaign workers can increment use_count when someone joins
DROP POLICY IF EXISTS "invites_update_campaign_workers" ON hid_outreach_invites;
CREATE POLICY "invites_update_campaign_workers" ON hid_outreach_invites
  FOR UPDATE TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_hid_outreach_invites_code ON hid_outreach_invites(code);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_invites_campaign_id ON hid_outreach_invites(campaign_id);
