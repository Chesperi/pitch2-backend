-- actor_id: supporta UUID staff come stringa (FK rimossa; riferimento logico a staff.id).
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;
ALTER TABLE audit_log ALTER COLUMN actor_id TYPE TEXT USING CASE
  WHEN actor_id IS NULL THEN NULL
  ELSE actor_id::text
END;
