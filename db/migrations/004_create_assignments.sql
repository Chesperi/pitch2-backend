CREATE TABLE IF NOT EXISTS assignments (
  id              SERIAL PRIMARY KEY,
  event_id        INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  staff_id        INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role_code       TEXT NOT NULL,
  fee             INTEGER,
  location        TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  plate_selected  TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_staff_id_idx ON assignments(staff_id);
CREATE INDEX IF NOT EXISTS assignments_event_id_idx ON assignments(event_id);
CREATE INDEX IF NOT EXISTS assignments_status_idx ON assignments(status);
