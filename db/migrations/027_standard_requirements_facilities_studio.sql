ALTER TABLE standard_requirements
  ADD COLUMN IF NOT EXISTS facilities TEXT,
  ADD COLUMN IF NOT EXISTS studio TEXT;
