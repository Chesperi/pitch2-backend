-- Permessi per pagina del gestionale (per staff).
-- TODO: aggiornare updated_at su UPDATE da API (come assignments/cookies_jar_tasks) oppure
--       introdurre un trigger generico condiviso se in futuro si standardizza il progetto.

CREATE TABLE staff_page_permissions (
  id            BIGSERIAL PRIMARY KEY,
  staff_id      INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  page_key      TEXT NOT NULL,
  access_level  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_page_permissions_access_level_check
    CHECK (access_level IN ('none', 'view', 'edit')),
  CONSTRAINT staff_page_permissions_staff_page_unique
    UNIQUE (staff_id, page_key)
);

CREATE INDEX idx_staff_page_permissions_page_staff
  ON staff_page_permissions (page_key, staff_id);

CREATE INDEX idx_staff_page_permissions_staff_id
  ON staff_page_permissions (staff_id);
