ALTER TABLE staff
  ADD COLUMN finance_visibility TEXT NOT NULL DEFAULT 'HIDDEN',
  ADD CONSTRAINT staff_finance_visibility_check
    CHECK (finance_visibility IN ('HIDDEN', 'VISIBLE'));
