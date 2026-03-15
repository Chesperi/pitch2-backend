CREATE TABLE staff (
  id                  SERIAL PRIMARY KEY,
  surname             TEXT NOT NULL,
  name                TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  place_of_birth      TEXT,
  date_of_birth       DATE,
  residential_address TEXT,
  id_number           TEXT,
  company             TEXT,
  default_role_code   TEXT REFERENCES roles(code),
  default_location    TEXT,
  fee                 INTEGER,
  plates              TEXT,
  user_level          TEXT NOT NULL DEFAULT 'FREELANCE',
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  notes               TEXT
);
