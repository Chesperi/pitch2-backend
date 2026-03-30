CREATE TABLE accreditations (
  id            SERIAL PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  staff_id      INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role_code     TEXT,
  areas         TEXT,
  plates        TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accreditations_event_staff_unique UNIQUE (event_id, staff_id)
);

CREATE INDEX accreditations_event_id_idx ON accreditations (event_id);
CREATE INDEX accreditations_staff_id_idx ON accreditations (staff_id);

CREATE OR REPLACE FUNCTION accreditations_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accreditations_updated_at
  BEFORE UPDATE ON accreditations
  FOR EACH ROW
  EXECUTE PROCEDURE accreditations_set_updated_at();
