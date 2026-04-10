ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS request_car_pass BOOLEAN,
  ADD COLUMN IF NOT EXISTS plate_selected TEXT;

