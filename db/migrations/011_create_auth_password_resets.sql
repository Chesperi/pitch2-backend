CREATE TABLE IF NOT EXISTS auth_password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS auth_password_resets_staff_id_idx
  ON auth_password_resets (staff_id, created_at DESC);
