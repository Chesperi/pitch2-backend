CREATE TABLE IF NOT EXISTS staff_role_fees (
  id            SERIAL PRIMARY KEY,
  staff_id      INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role_code     TEXT NOT NULL,
  location      TEXT NOT NULL,
  fee           NUMERIC(10,2) NOT NULL DEFAULT 0,
  extra_fee     NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, role_code, location)
);

CREATE INDEX IF NOT EXISTS idx_staff_role_fees_staff_role_location
  ON staff_role_fees (staff_id, role_code, location);

CREATE INDEX IF NOT EXISTS idx_staff_role_fees_role_location
  ON staff_role_fees (role_code, location);
