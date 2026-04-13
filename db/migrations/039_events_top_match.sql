ALTER TABLE events ADD COLUMN IF NOT EXISTS is_top_match boolean NOT NULL DEFAULT false;
