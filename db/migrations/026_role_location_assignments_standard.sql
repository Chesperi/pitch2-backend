-- Ruoli: univocità su (role_code, location), non su role_code da solo.
-- assignments / standard_requirements memorizzano la coppia per join e FK non ambigui.

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS role_location TEXT;
ALTER TABLE standard_requirements ADD COLUMN IF NOT EXISTS role_location TEXT;

UPDATE assignments a
SET role_location = (
  SELECT r.location FROM roles r WHERE r.role_code = a.role_code ORDER BY r.id ASC LIMIT 1
)
WHERE a.role_location IS NULL;

UPDATE standard_requirements sr
SET role_location = (
  SELECT r.location FROM roles r WHERE r.role_code = sr.role_code ORDER BY r.id ASC LIMIT 1
)
WHERE sr.role_location IS NULL;

UPDATE assignments SET role_location = 'COLOGNO' WHERE role_location IS NULL;
UPDATE standard_requirements SET role_location = 'COLOGNO' WHERE role_location IS NULL;

ALTER TABLE assignments ALTER COLUMN role_location SET NOT NULL;
ALTER TABLE standard_requirements ALTER COLUMN role_location SET NOT NULL;

DROP INDEX IF EXISTS roles_role_code_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS roles_role_code_location_uidx
  ON roles (role_code, location);

ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_role_code_fkey;
ALTER TABLE standard_requirements DROP CONSTRAINT IF EXISTS standard_requirements_role_code_fkey;

ALTER TABLE assignments
  ADD CONSTRAINT assignments_role_code_location_fkey
  FOREIGN KEY (role_code, role_location) REFERENCES roles (role_code, location);

ALTER TABLE standard_requirements
  ADD CONSTRAINT standard_requirements_role_code_location_fkey
  FOREIGN KEY (role_code, role_location) REFERENCES roles (role_code, location);

CREATE INDEX IF NOT EXISTS assignments_role_code_location_idx
  ON assignments (role_code, role_location);
