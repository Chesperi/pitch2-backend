ALTER TABLE events
  ADD COLUMN IF NOT EXISTS standard_combo_id int
    REFERENCES standard_combos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_standard_combo
  ON events(standard_combo_id);
