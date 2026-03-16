-- Add role_id to assignments (migrate from role_code if it exists)
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id);

-- Migrate role_code -> role_id for existing rows
UPDATE assignments a
SET role_id = (SELECT r.id FROM roles r WHERE r.code = a.role_code LIMIT 1)
WHERE a.role_id IS NULL AND a.role_code IS NOT NULL;

-- Drop old columns
ALTER TABLE assignments DROP COLUMN IF EXISTS role_code;
ALTER TABLE assignments DROP COLUMN IF EXISTS fee;
ALTER TABLE assignments DROP COLUMN IF EXISTS location;
ALTER TABLE assignments DROP COLUMN IF EXISTS plate_selected;

-- Make staff_id nullable (slot vuoto = staff_id NULL)
ALTER TABLE assignments ALTER COLUMN staff_id DROP NOT NULL;

-- Update status default and migrate PENDING -> DRAFT
ALTER TABLE assignments ALTER COLUMN status SET DEFAULT 'DRAFT';
UPDATE assignments SET status = 'DRAFT' WHERE status IN ('PENDING', 'READY_TO_SEND');

-- Ensure notes exists (already in 004)
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS notes TEXT;

-- Remove rows that could not be migrated (invalid role_code)
DELETE FROM assignments WHERE role_id IS NULL;

-- role_id must be NOT NULL for new designations
ALTER TABLE assignments ALTER COLUMN role_id SET NOT NULL;

-- Add assignments_status to events
ALTER TABLE events ADD COLUMN IF NOT EXISTS assignments_status TEXT NOT NULL DEFAULT 'DRAFT';

-- Index for role_id lookups
CREATE INDEX IF NOT EXISTS assignments_role_id_idx ON assignments(role_id);
