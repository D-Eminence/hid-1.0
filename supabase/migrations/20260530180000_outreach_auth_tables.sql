-- Outreach authentication: OTP verification + audit log

CREATE TABLE IF NOT EXISTS hid_outreach_otp (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  resend_count INTEGER NOT NULL DEFAULT 0,
  max_resends INTEGER NOT NULL DEFAULT 3,
  last_resend_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- No RLS policies = service role only (edge functions)
ALTER TABLE hid_outreach_otp ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_hid_outreach_otp_email ON hid_outreach_otp(email);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_otp_auth_user_id ON hid_outreach_otp(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_otp_expires_at ON hid_outreach_otp(expires_at);

-- Audit log for admin visibility
CREATE TABLE IF NOT EXISTS hid_outreach_auth_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event TEXT NOT NULL,
  email TEXT,
  auth_user_id UUID,
  worker_id UUID,
  campaign_id UUID,
  ip TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE hid_outreach_auth_log ENABLE ROW LEVEL SECURITY;

-- Admins can read the auth log
DROP POLICY IF EXISTS "auth_log_select_admins" ON hid_outreach_auth_log;
CREATE POLICY "auth_log_select_admins" ON hid_outreach_auth_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM hid_outreach_workers
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_hid_outreach_auth_log_event ON hid_outreach_auth_log(event);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_auth_log_email ON hid_outreach_auth_log(email);
CREATE INDEX IF NOT EXISTS idx_hid_outreach_auth_log_created_at ON hid_outreach_auth_log(created_at DESC);
