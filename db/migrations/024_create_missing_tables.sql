-- Tabelle richieste dal backend ma assenti dallo schema Excel/Supabase iniziale.
-- Convenzioni (come da task):
--   staff_id INTEGER → REFERENCES staff(id)
--   event_id TEXT    → REFERENCES events(id)
--   role_code TEXT   → REFERENCES roles(role_code) (richiede univocità su roles.role_code)
--
-- NOTA: Il codice TypeScript attuale usa ancora in molti punti role_id e colonne events/roles
--       diverse da questo schema: vedi commento in coda e lista mismatch nel PR.

-- ---------------------------------------------------------------------------
-- Prerequisito: FK verso roles(role_code)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS roles_role_code_uidx ON roles (role_code);

-- ---------------------------------------------------------------------------
-- 1) Tabelle senza FK a staff/events (o solo testo owner_code)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accreditation_areas (
  id          SERIAL PRIMARY KEY,
  owner_code  TEXT NOT NULL,
  role_code   TEXT NOT NULL,
  areas       TEXT NOT NULL,
  CONSTRAINT accreditation_areas_owner_role_unique UNIQUE (owner_code, role_code)
);

CREATE TABLE IF NOT EXISTS accreditation_area_legends (
  id          SERIAL PRIMARY KEY,
  owner_code  TEXT NOT NULL,
  area_code   TEXT NOT NULL,
  description TEXT NOT NULL,
  CONSTRAINT accreditation_area_legends_owner_area_unique UNIQUE (owner_code, area_code)
);

-- ---------------------------------------------------------------------------
-- 2) Tabelle con FK a staff(id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS magic_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   INTEGER NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  token      UUID NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links (token);

CREATE TABLE IF NOT EXISTS auth_magic_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      INTEGER NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  redirect_path TEXT NOT NULL DEFAULT '/designazioni'
);

CREATE INDEX IF NOT EXISTS idx_auth_magic_links_token ON auth_magic_links (token);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     INTEGER NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success      BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_staff_id_idx
  ON auth_login_attempts (staff_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS staff_page_permissions (
  id            BIGSERIAL PRIMARY KEY,
  staff_id      INTEGER NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  page_key      TEXT NOT NULL,
  access_level  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_page_permissions_access_level_check
    CHECK (access_level IN ('none', 'view', 'edit')),
  CONSTRAINT staff_page_permissions_staff_page_unique
    UNIQUE (staff_id, page_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_page_permissions_page_staff
  ON staff_page_permissions (page_key, staff_id);

CREATE INDEX IF NOT EXISTS idx_staff_page_permissions_staff_id
  ON staff_page_permissions (staff_id);

-- actor_id: TEXT per supportare UUID sessione / valori non numerici (allineato a auditLog.ts)
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id  TEXT,
  ip_address  TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity_created_at
  ON audit_log (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created_at
  ON audit_log (actor_type, actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS documents (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL,
  competition     TEXT NOT NULL DEFAULT '',
  valid_from      DATE,
  valid_to        DATE,
  tags            TEXT[] NOT NULL DEFAULT '{}'::text[],
  file_path       TEXT NOT NULL,
  uploaded_by_id  INTEGER REFERENCES staff (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_category_check
    CHECK (category IN ('REGULATION', 'TECH_SPEC', 'INTERNAL_PROCEDURE', 'OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_documents_competition ON documents (competition);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents (category);
CREATE INDEX IF NOT EXISTS idx_documents_tags_gin ON documents USING GIN (tags);

CREATE TABLE IF NOT EXISTS cookies_jar_tasks (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  assignee_id  INTEGER REFERENCES staff (id) ON DELETE SET NULL,
  team         TEXT NOT NULL DEFAULT '',
  project      TEXT NOT NULL DEFAULT '',
  start_date   DATE NOT NULL,
  status       TEXT NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cookies_jar_tasks_status_check
    CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE', 'ON_HOLD'))
);

CREATE INDEX IF NOT EXISTS idx_cookies_jar_tasks_start_date_team
  ON cookies_jar_tasks (start_date, team);

CREATE INDEX IF NOT EXISTS idx_cookies_jar_tasks_assignee_id_status
  ON cookies_jar_tasks (assignee_id, status);

-- ---------------------------------------------------------------------------
-- 3) standard_requirements → role_code (FK logica su roles.role_code)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS standard_requirements (
  id               SERIAL PRIMARY KEY,
  standard_onsite  TEXT NOT NULL,
  standard_cologno TEXT NOT NULL,
  site             TEXT NOT NULL,
  area_produzione  TEXT NOT NULL,
  role_code        TEXT NOT NULL REFERENCES roles (role_code),
  quantity         INTEGER NOT NULL DEFAULT 1,
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_standard_requirements_combo
  ON standard_requirements (standard_onsite, standard_cologno, site);

-- ---------------------------------------------------------------------------
-- 4) assignments / accreditations → event_id TEXT, staff_id INTEGER, role_code
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  id         SERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  role_code  TEXT NOT NULL REFERENCES roles (role_code),
  staff_id   INTEGER REFERENCES staff (id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'DRAFT',
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_staff_id_idx ON assignments (staff_id);
CREATE INDEX IF NOT EXISTS assignments_event_id_idx ON assignments (event_id);
CREATE INDEX IF NOT EXISTS assignments_status_idx ON assignments (status);
CREATE INDEX IF NOT EXISTS assignments_role_code_idx ON assignments (role_code);

CREATE TABLE IF NOT EXISTS accreditations (
  id         SERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  staff_id   INTEGER NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  role_code  TEXT,
  areas      TEXT,
  plates     TEXT,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accreditations_event_staff_unique UNIQUE (event_id, staff_id)
);

CREATE INDEX IF NOT EXISTS accreditations_event_id_idx ON accreditations (event_id);
CREATE INDEX IF NOT EXISTS accreditations_staff_id_idx ON accreditations (staff_id);

CREATE OR REPLACE FUNCTION accreditations_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accreditations_updated_at ON accreditations;
CREATE TRIGGER accreditations_updated_at
  BEFORE UPDATE ON accreditations
  FOR EACH ROW
  EXECUTE PROCEDURE accreditations_set_updated_at();
