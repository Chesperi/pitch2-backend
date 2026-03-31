-- Ponte opzionale tra auth.users.id e staff quando la PK staff non coincide con Supabase.
-- Se staff.id è già UUID uguale a auth.users.id, la colonna può restare NULL.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS supabase_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS staff_supabase_id_uidx
  ON staff (supabase_id)
  WHERE supabase_id IS NOT NULL;
