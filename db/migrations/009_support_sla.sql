ALTER TABLE support_cases
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

ALTER TABLE support_cases
  ADD COLUMN IF NOT EXISTS first_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;

UPDATE support_cases
  SET sla_due_at = created_at + INTERVAL '24 hours'
  WHERE sla_due_at IS NULL;

CREATE INDEX IF NOT EXISTS support_cases_site_sla_idx
  ON support_cases (site_id, sla_due_at)
  WHERE status <> 'resolved' AND first_response_at IS NULL;
