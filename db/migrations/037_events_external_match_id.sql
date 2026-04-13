ALTER TABLE events ADD COLUMN IF NOT EXISTS external_match_id text;
CREATE INDEX IF NOT EXISTS idx_events_external_match_id ON events(external_match_id);
