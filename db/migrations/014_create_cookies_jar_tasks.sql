CREATE TABLE cookies_jar_tasks (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  assignee_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  team          TEXT NOT NULL DEFAULT '',
  project       TEXT NOT NULL DEFAULT '',
  start_date    DATE NOT NULL,
  status        TEXT NOT NULL,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cookies_jar_tasks_status_check
    CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE', 'ON_HOLD'))
);

CREATE INDEX idx_cookies_jar_tasks_start_date_team
  ON cookies_jar_tasks (start_date, team);

CREATE INDEX idx_cookies_jar_tasks_assignee_id_status
  ON cookies_jar_tasks (assignee_id, status);
