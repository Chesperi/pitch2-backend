-- Rename lookup value and event data from DAZN/SKY to SKY/DAZN (canonical label).
UPDATE lookup_values
SET value = 'SKY/DAZN'
WHERE category = 'rights_holder' AND value = 'DAZN/SKY';

UPDATE events
SET rights_holder = 'SKY/DAZN'
WHERE rights_holder = 'DAZN/SKY';

INSERT INTO lookup_values (category, value, sort_order) VALUES
  ('rights_holder', 'SKY/DAZN', 2)
ON CONFLICT (category, value) DO NOTHING;
