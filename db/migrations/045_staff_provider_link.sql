ALTER TABLE staff
ADD COLUMN IF NOT EXISTS provider_id INTEGER REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_provider_id
  ON staff (provider_id);
