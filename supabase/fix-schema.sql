CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE patients ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS last_name text;
-- LEGACY MVP PATCH FILE
-- This file exists for the original prototype schema only.
-- Use supabase/migrations/20260407130000_secure_backend_foundation.sql for the secure backend path.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS auth_password_hash text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nin_verified boolean DEFAULT false;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS notifications_enabled boolean DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);

ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS attachment_name text;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS attachment_type text;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS attachment_data_url text;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS transcription_text text;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS added_by_role text DEFAULT 'patient';
CREATE INDEX IF NOT EXISTS idx_records_category ON medical_records(category);
CREATE INDEX IF NOT EXISTS idx_records_hid_created ON medical_records(hid_code, created_at DESC);

CREATE TABLE IF NOT EXISTS medical_record_files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_id uuid NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_data_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_record_files_record ON medical_record_files(record_id);
CREATE INDEX IF NOT EXISTS idx_record_files_record_created ON medical_record_files(record_id, created_at);

CREATE TABLE IF NOT EXISTS patient_notes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  hid_code text NOT NULL,
  note text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_notes_hid ON patient_notes(hid_code);

CREATE TABLE IF NOT EXISTS staff_accounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name text NOT NULL,
  hospital_name text,
  verification_status text DEFAULT 'pending_profile',
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'doctor',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  hid_code text NOT NULL,
  doctor_account_id uuid,
  doctor_name text NOT NULL,
  request_type text NOT NULL DEFAULT 'standard',
  status text NOT NULL DEFAULT 'pending',
  reason text,
  pin_verified boolean NOT NULL DEFAULT false,
  approved_by text,
  approved_at timestamptz,
  duration_hours integer,
  access_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requests_hid ON access_requests(hid_code);
CREATE INDEX IF NOT EXISTS idx_requests_status ON access_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_doctor_created ON access_requests(doctor_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_hid_status_created ON access_requests(hid_code, status, created_at DESC);

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE INDEX IF NOT EXISTS idx_logs_request_time ON access_logs(request_id, access_time DESC);
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS hospital_name text;
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending_profile';

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  hid_code text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'system',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_hid ON notifications(hid_code);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_hid_created ON notifications(hid_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_hid_read_created ON notifications(hid_code, is_read, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'access_requests') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE access_requests';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'access_logs') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE access_logs';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE notifications';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'staff_accounts') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE staff_accounts';
    END IF;
  END IF;
END;
$$;

ALTER TABLE staff_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
