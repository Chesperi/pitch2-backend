CREATE TABLE IF NOT EXISTS clubs (
  id SERIAL PRIMARY KEY,
  owner_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
