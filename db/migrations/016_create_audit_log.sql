CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type   TEXT NOT NULL,
  actor_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id   TEXT,
  ip_address   TEXT,
  user_agent   TEXT
);

CREATE INDEX idx_audit_log_entity_created_at
  ON audit_log (entity_type, entity_id, created_at DESC);

CREATE INDEX idx_audit_log_actor_created_at
  ON audit_log (actor_type, actor_id, created_at DESC);

CREATE INDEX idx_audit_log_created_at
  ON audit_log (created_at DESC);
