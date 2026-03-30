CREATE TABLE auth_magic_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ NULL,
  redirect_path TEXT NOT NULL DEFAULT '/designazioni'
);

CREATE INDEX idx_auth_magic_links_token ON auth_magic_links(token);
