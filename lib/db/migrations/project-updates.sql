-- Project updates (DECISIONS.md › Project updates). Additive only: creates two
-- new tables and their indexes; never alters or deletes existing data, and never
-- touches projects.stage or any legacy replit_uid column.
CREATE TABLE IF NOT EXISTS project_updates (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filmmaker_id integer NOT NULL REFERENCES filmmakers(id) ON DELETE CASCADE,
  milestone_key text NOT NULL,
  role text,
  person_name text,
  name_consent boolean NOT NULL DEFAULT false,
  custom_label text,
  note text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  emails_queued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_updates_milestone_check CHECK (milestone_key IN (
    'script_draft_finished', 'script_locked', 'budget_schedule_done', 'lead_cast_attached', 'proof_of_concept_out',
    'locations_secured', 'shoot_dates_set', 'filming_started', 'filming_wrapped', 'final_cut_locked',
    'festival_selection', 'award_or_press', 'distributor_signed', 'release_date_set', 'released',
    'team_member_joined', 'other_funding_secured', 'other')),
  CONSTRAINT project_updates_role_check CHECK (role IS NULL OR role IN (
    'producer', 'director', 'writer', 'executive_producer', 'cinematographer', 'casting_director', 'other')),
  CONSTRAINT project_updates_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT project_updates_name_consent_check CHECK (person_name IS NULL OR name_consent),
  CONSTRAINT project_updates_name_length_check CHECK (person_name IS NULL OR char_length(person_name) <= 80),
  CONSTRAINT project_updates_label_check CHECK (
    (milestone_key = 'other' AND custom_label IS NOT NULL AND char_length(custom_label) BETWEEN 1 AND 60)
    OR (milestone_key <> 'other' AND custom_label IS NULL)),
  CONSTRAINT project_updates_note_length_check CHECK (note IS NULL OR char_length(note) <= 500)
);
CREATE INDEX IF NOT EXISTS project_updates_project_status_idx ON project_updates (project_id, status, created_at);
CREATE INDEX IF NOT EXISTS project_updates_status_idx ON project_updates (status);

CREATE TABLE IF NOT EXISTS project_update_emails (
  id serial PRIMARY KEY,
  update_id integer NOT NULL REFERENCES project_updates(id) ON DELETE CASCADE,
  investor_id integer NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  email_status text NOT NULL DEFAULT 'pending',
  email_uncertain boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_update_emails_status_check
    CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'unconfigured'))
);
-- A backer can never get the same update twice.
CREATE UNIQUE INDEX IF NOT EXISTS project_update_emails_update_investor_unique
  ON project_update_emails (update_id, investor_id);
