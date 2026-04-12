INSERT INTO lookup_values (category, value, sort_order) VALUES
  ('rights_holder', 'DAZN', 1),
  ('rights_holder', 'SKY/DAZN', 2)
ON CONFLICT (category, value) DO NOTHING;
