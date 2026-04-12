CREATE TABLE lookup_values (
  id         serial PRIMARY KEY,
  category   text NOT NULL,
  value      text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lookup_values_unique UNIQUE (category, value)
);

CREATE INDEX idx_lookup_values_category ON lookup_values(category);

-- Seed valori iniziali
INSERT INTO lookup_values (category, value, sort_order) VALUES
  ('standard_onsite',  'DAZN1',       1),
  ('standard_onsite',  'DAZN2',       2),
  ('standard_onsite',  'DAZN3',       3),
  ('standard_cologno', 'OFFTUBE',     1),
  ('standard_cologno', 'GALLERY',     2),
  ('standard_cologno', 'PCR',         3),
  ('facilities',       'PCR01',       1),
  ('facilities',       'GALLERY01',   2),
  ('studio',           'GREEN',       1),
  ('studio',           'BLUE',        2),
  ('show',             'FUORICLASSE', 1),
  ('show',             'VAMOS!',      2),
  ('show',             'ZONE',        3);
