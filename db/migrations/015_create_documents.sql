CREATE TABLE documents (
  id               SERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  category         TEXT NOT NULL,
  competition      TEXT NOT NULL DEFAULT '',
  valid_from       DATE,
  valid_to         DATE,
  tags             TEXT[] NOT NULL DEFAULT '{}'::text[],
  file_path        TEXT NOT NULL,
  uploaded_by_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_category_check
    CHECK (category IN ('REGULATION', 'TECH_SPEC', 'INTERNAL_PROCEDURE', 'OTHER'))
);

CREATE INDEX idx_documents_competition ON documents (competition);

CREATE INDEX idx_documents_category ON documents (category);

CREATE INDEX idx_documents_tags_gin ON documents USING GIN (tags);
