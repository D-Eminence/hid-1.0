-- LEGACY MVP SCHEMA
-- This file reflects the earlier prototype model and is not the production-safe backend anymore.
-- Use supabase/migrations/20260407130000_secure_backend_foundation.sql for the secure Supabase-native backend.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name text,
  last_name text,
  full_name text NOT NULL,
  phone text UNIQUE,
  email text,
  gender text,
  auth_password_hash text,
  blood_group text NOT NULL DEFAULT 'Unknown',
  nin_verified boolean DEFAULT false,
  hid_code text NOT NULL UNIQUE,
  pin text,
  dob date,
  nin text,
  country text,
  state text,
  genotype text,
  allergies text,
  chronic_conditions text,
  current_medications text,
  photo_url text,
  emergency_contact_name text,
  emergency_contact_relationship text,
  emergency_contact_phone text,
  emergency_contact_address text,
  medical_notes text,
  profile_percent integer DEFAULT 0,
  notifications_enabled boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patients_hid ON patients(hid_code);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);

CREATE TABLE IF NOT EXISTS medical_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  hid_code text NOT NULL,
  title text NOT NULL DEFAULT 'Medical Record',
  category text NOT NULL DEFAULT 'other',
  record text NOT NULL,
  notes text,
  attachment_name text,
  attachment_type text,
  attachment_data_url text,
  transcription_text text,
  created_by text NOT NULL DEFAULT 'System',
  added_by_role text DEFAULT 'patient',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_records_hid ON medical_records(hid_code);
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

CREATE TABLE IF NOT EXISTS access_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  hid_code text NOT NULL,
  accessed_by text NOT NULL,
  access_time timestamptz NOT NULL DEFAULT now(),
  reason text,
  access_type text NOT NULL DEFAULT 'standard',
  request_id uuid
);

CREATE INDEX IF NOT EXISTS idx_logs_hid ON access_logs(hid_code);
CREATE INDEX IF NOT EXISTS idx_logs_time ON access_logs(access_time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_request_time ON access_logs(request_id, access_time DESC);

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

CREATE OR REPLACE FUNCTION prevent_log_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Access logs are immutable and cannot be modified or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS no_update_logs ON access_logs;
CREATE TRIGGER no_update_logs
  BEFORE UPDATE OR DELETE ON access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_log_modification();

ALTER TABLE patients DISABLE ROW LEVEL SECURITY;
ALTER TABLE medical_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE staff_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
