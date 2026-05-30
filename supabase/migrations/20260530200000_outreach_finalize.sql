-- Allow anon users to read campaigns (needed for /outreach/join invite preview)
-- Campaigns only contain org name, campaign name, location — no patient data.
DROP POLICY IF EXISTS "campaigns_select_for_authenticated" ON hid_outreach_campaigns;
CREATE POLICY "campaigns_select_public" ON hid_outreach_campaigns
  FOR SELECT USING (true);

-- Ensure invites are readable without auth (join page code lookup)
DROP POLICY IF EXISTS "invites_select_public" ON hid_outreach_invites;
CREATE POLICY "invites_select_public" ON hid_outreach_invites
  FOR SELECT USING (true);
