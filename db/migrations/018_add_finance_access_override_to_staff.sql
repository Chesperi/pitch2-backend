ALTER TABLE staff
  ADD COLUMN finance_access_override TEXT NULL,
  ADD CONSTRAINT staff_finance_access_override_check
    CHECK (
      finance_access_override IN ('allow', 'deny')
      OR finance_access_override IS NULL
    );
