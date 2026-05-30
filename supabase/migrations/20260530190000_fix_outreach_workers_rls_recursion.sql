-- Fix infinite recursion in hid_outreach_workers RLS
-- The "workers_select_campaign_members" policy subqueries hid_outreach_workers
-- to check access to hid_outreach_workers — causing infinite recursion.
-- The "workers_select_own" policy (auth_user_id = auth.uid()) is sufficient:
-- each worker only needs their own record to load the outreach workspace.
DROP POLICY IF EXISTS "workers_select_campaign_igns" ON hid_outreach_workers;
DROP POLICY IF EXISTS "workers_select_campaign_members" ON hid_outreach_workers;
