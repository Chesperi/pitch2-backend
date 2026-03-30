CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success     BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_staff_id_idx
  ON auth_login_attempts (staff_id, attempted_at DESC);
