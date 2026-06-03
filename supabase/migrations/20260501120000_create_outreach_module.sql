-- Outreach Module Schema
-- Enables field-based health outreach campaigns with worker coordination,
-- encounter registration, and queue-based sync to main records system.

-- hid_outreach_campaigns
CREATE TABLE IF NOT EXISTS hid_outreach_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  org TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'closed')),
  services TEXT[] NOT NULL DEFAULT ARRAY['registration'],
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE hid_outreach_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_select_for_authenticated" ON hid_outreach_campaigns;
CREATE POLICY "campaigns_select_for_authenticated" ON hid_outreach_campaigns
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_hid_outreach_campaigns_status ON hid_outreach_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_campaigns_starts_at ON hid_outreach_campaigns(starts_at DESC);

-- hid_outreach_workers
CREATE TABLE IF NOT EXISTS hid_outreach_workers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES hid_outreach_campaigns(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'enumerator' CHECK (role IN ('enumerator', 'health_worker', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(auth_user_id, campaign_id)
);

ALTER TABLE hid_outreach_workers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workers_select_own" ON hid_outreach_workers;
CREATE POLICY "workers_select_own" ON hid_outreach_workers
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "workers_select_campaign_members" ON hid_outreach_workers;
CREATE POLICY "workers_select_campaign_members" ON hid_outreach_workers
  FOR SELECT TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_hid_outreach_workers_auth_user_id ON hid_outreach_workers(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_workers_campaign_id ON hid_outreach_workers(campaign_id);

-- hid_outreach_encounters
CREATE TABLE IF NOT EXISTS hid_outreach_encounters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES hid_outreach_campaigns(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES hid_outreach_workers(id) ON DELETE CASCADE,
  patient_hid TEXT,
  provisional_patient_id TEXT,
  full_name TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female', 'other')),
  age_years INTEGER NOT NULL,
  phone TEXT,
  service_type TEXT NOT NULL DEFAULT 'registration' CHECK (service_type IN ('registration', 'vitals', 'vaccination', 'lab_sample', 'referral')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('draft', 'queued', 'synced', 'referred')),
  notes TEXT,
  consent_captured_at TIMESTAMP WITH TIME ZONE,
  consent_method TEXT CHECK (consent_method IS NULL OR consent_method IN ('pin', 'signature', 'verbal_witness')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  synced_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE hid_outreach_encounters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "encounters_select_campaign_workers" ON hid_outreach_encounters;
CREATE POLICY "encounters_select_campaign_workers" ON hid_outreach_encounters
  FOR SELECT TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "encounters_insert_campaign_workers" ON hid_outreach_encounters;
CREATE POLICY "encounters_insert_campaign_workers" ON hid_outreach_encounters
  FOR INSERT TO authenticated WITH CHECK (
    worker_id IN (
      SELECT id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_hid_outreach_encounters_campaign_id ON hid_outreach_encounters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_encounters_worker_id ON hid_outreach_encounters(worker_id);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_encounters_status ON hid_outreach_encounters(status);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_encounters_created_at ON hid_outreach_encounters(created_at DESC);

-- hid_sync_queue — offline-first sync coordination
CREATE TABLE IF NOT EXISTS hid_sync_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES hid_outreach_campaigns(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES hid_outreach_workers(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN ('encounter', 'vaccination', 'referral', 'mobile_lab_sample')),
  action TEXT NOT NULL CHECK (action IN ('insert', 'update')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'syncing', 'failed', 'synced')),
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  synced_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE hid_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_queue_select_campaign_workers" ON hid_sync_queue;
CREATE POLICY "sync_queue_select_campaign_workers" ON hid_sync_queue
  FOR SELECT TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "sync_queue_insert_campaign_workers" ON hid_sync_queue;
CREATE POLICY "sync_queue_insert_campaign_workers" ON hid_sync_queue
  FOR INSERT TO authenticated WITH CHECK (
    worker_id IN (
      SELECT id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_hid_sync_queue_campaign_id ON hid_sync_queue(campaign_id);
CREATE INDEX IF NOT EXISTS idx_hid_sync_queue_worker_id ON hid_sync_queue(worker_id);
CREATE INDEX IF NOT EXISTS idx_hid_sync_queue_status ON hid_sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_hid_sync_queue_entity ON hid_sync_queue(entity);

-- hid_outreach_referrals
CREATE TABLE IF NOT EXISTS hid_outreach_referrals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  encounter_id UUID REFERENCES hid_outreach_encounters(id) ON DELETE SET NULL,
  campaign_id UUID NOT NULL REFERENCES hid_outreach_campaigns(id) ON DELETE CASCADE,
  facility_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'soon', 'urgent')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE hid_outreach_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_select_campaign_workers" ON hid_outreach_referrals;
CREATE POLICY "referrals_select_campaign_workers" ON hid_outreach_referrals
  FOR SELECT TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_hid_outreach_referrals_campaign_id ON hid_outreach_referrals(campaign_id);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_referrals_encounter_id ON hid_outreach_referrals(encounter_id);

-- hid_vaccinations
CREATE TABLE IF NOT EXISTS hid_vaccinations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  encounter_id UUID REFERENCES hid_outreach_encounters(id) ON DELETE SET NULL,
  campaign_id UUID NOT NULL REFERENCES hid_outreach_campaigns(id) ON DELETE CASCADE,
  vaccine_name TEXT NOT NULL,
  dose_label TEXT NOT NULL,
  vial_lot TEXT NOT NULL,
  administered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  aefi_observed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT
);

ALTER TABLE hid_vaccinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vaccinations_select_campaign_workers" ON hid_vaccinations;
CREATE POLICY "vaccinations_select_campaign_workers" ON hid_vaccinations
  FOR SELECT TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_hid_vaccinations_campaign_id ON hid_vaccinations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_hid_vaccinations_encounter_id ON hid_vaccinations(encounter_id);

-- hid_mobile_lab_samples
CREATE TABLE IF NOT EXISTS hid_mobile_lab_samples (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  encounter_id UUID REFERENCES hid_outreach_encounters(id) ON DELETE SET NULL,
  campaign_id UUID NOT NULL REFERENCES hid_outreach_campaigns(id) ON DELETE CASCADE,
  sample_type TEXT NOT NULL,
  barcode TEXT NOT NULL,
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  cold_chain_required BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE hid_mobile_lab_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lab_samples_select_campaign_workers" ON hid_mobile_lab_samples;
CREATE POLICY "lab_samples_select_campaign_workers" ON hid_mobile_lab_samples
  FOR SELECT TO authenticated USING (
    campaign_id IN (
      SELECT campaign_id FROM hid_outreach_workers WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_hid_mobile_lab_samples_campaign_id ON hid_mobile_lab_samples(campaign_id);
CREATE INDEX IF NOT EXISTS idx_hid_mobile_lab_samples_encounter_id ON hid_mobile_lab_samples(encounter_id);
