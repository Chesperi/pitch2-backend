CREATE TABLE accreditation_areas (
  id          SERIAL PRIMARY KEY,
  owner_code  TEXT NOT NULL,
  role_code   TEXT NOT NULL,
  areas       TEXT NOT NULL,
  CONSTRAINT accreditation_areas_owner_role_unique UNIQUE (owner_code, role_code)
);

CREATE TABLE accreditation_area_legends (
  id          SERIAL PRIMARY KEY,
  owner_code  TEXT NOT NULL,
  area_code   TEXT NOT NULL,
  description TEXT NOT NULL,
  CONSTRAINT accreditation_area_legends_owner_area_unique UNIQUE (owner_code, area_code)
);
