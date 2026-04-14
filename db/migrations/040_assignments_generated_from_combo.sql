ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS generated_from_combo_id INTEGER
  REFERENCES standard_combos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_generated_from_combo_id
  ON assignments(generated_from_combo_id);
