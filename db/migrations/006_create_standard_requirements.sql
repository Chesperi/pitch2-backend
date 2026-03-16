CREATE TABLE standard_requirements (
  id SERIAL PRIMARY KEY,
  standard_onsite TEXT NOT NULL,
  standard_cologno TEXT NOT NULL,
  site TEXT NOT NULL,
  area_produzione TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

CREATE INDEX idx_standard_requirements_combo
  ON standard_requirements (standard_onsite, standard_cologno, site);
