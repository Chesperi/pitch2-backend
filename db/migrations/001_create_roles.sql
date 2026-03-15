CREATE TABLE roles (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  location        TEXT NOT NULL,
  description     TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE
);
