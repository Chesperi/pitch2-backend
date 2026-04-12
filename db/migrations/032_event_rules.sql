CREATE TABLE event_rules (
  id                    serial PRIMARY KEY,
  competition_name      text,
  day_of_week           int CHECK (day_of_week BETWEEN 0 AND 6),
  ko_time_from          time,
  ko_time_to            time,
  standard_onsite       text,
  standard_cologno      text,
  facilities            text,
  studio                text,
  show_name             text,
  pre_duration_minutes  int,
  priority              int NOT NULL DEFAULT 0,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_rules_competition ON event_rules(competition_name);
