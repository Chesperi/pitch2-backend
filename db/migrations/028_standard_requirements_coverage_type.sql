ALTER TABLE standard_requirements
  ADD COLUMN IF NOT EXISTS coverage_type TEXT NOT NULL DEFAULT 'FREELANCE';

ALTER TABLE standard_requirements
  DROP CONSTRAINT IF EXISTS standard_requirements_coverage_type_check;

ALTER TABLE standard_requirements
  ADD CONSTRAINT standard_requirements_coverage_type_check
  CHECK (coverage_type IN ('FREELANCE', 'PROVIDER', 'EITHER'));

