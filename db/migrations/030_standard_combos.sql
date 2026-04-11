-- Documentazione schema già applicato su Supabase (non rieseguire se il DB è allineato).
-- Pacchetti standard: header in standard_combos, righe ruolo in standard_requirements.standard_combo_id.

CREATE TABLE IF NOT EXISTS standard_combos (
  id               SERIAL PRIMARY KEY,
  standard_onsite  TEXT NOT NULL,
  standard_cologno TEXT NOT NULL,
  facilities       TEXT,
  studio           TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standard_combos_onsite_cologno
  ON standard_combos (standard_onsite, standard_cologno);

-- Collegamento righe requirement al pacchetto; ON DELETE CASCADE elimina le righe se si elimina il combo.
ALTER TABLE standard_requirements
  ADD COLUMN IF NOT EXISTS standard_combo_id INTEGER REFERENCES standard_combos (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_standard_requirements_combo_id
  ON standard_requirements (standard_combo_id)
  WHERE standard_combo_id IS NOT NULL;
