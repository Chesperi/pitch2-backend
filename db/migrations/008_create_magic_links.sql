CREATE TABLE magic_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token      UUID NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ NULL
);

CREATE INDEX idx_magic_links_token ON magic_links(token);
