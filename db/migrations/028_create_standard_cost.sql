CREATE TABLE IF NOT EXISTS standard_cost (
  id               BIGSERIAL PRIMARY KEY,
  service          TEXT NOT NULL,
  provider         TEXT NOT NULL,
  costexclusive    NUMERIC,
  costcoexclusive  NUMERIC,
  extra            NUMERIC,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT standard_cost_service_provider_uidx UNIQUE (service, provider)
);

CREATE INDEX IF NOT EXISTS idx_standard_cost_provider_service
  ON standard_cost (provider, service);
