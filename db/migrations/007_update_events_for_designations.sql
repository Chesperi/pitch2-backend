-- events: standard_onsite, standard_cologno, location (area_produzione) are already TEXT
-- Index for onlyDesignable filter (standard_onsite, standard_cologno, status)
CREATE INDEX IF NOT EXISTS idx_events_designable
  ON events (standard_onsite, standard_cologno, status)
  WHERE standard_onsite IS NOT NULL AND standard_onsite <> ''
    AND standard_cologno IS NOT NULL AND standard_cologno <> '';
