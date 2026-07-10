begin;

-- Keep a single patient registration RPC so Supabase/PostgREST cannot
-- ambiguously resolve the older 5-argument overload after the coverage
-- fields were added.
drop function if exists public.hid_register_patient_profile(
  text,
  text,
  text,
  date,
  text
);

commit;
