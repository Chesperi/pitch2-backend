-- Colonna richiesta da `createPasswordResetToken` (staff_id, email, token, expires_at).
ALTER TABLE auth_password_resets
  ADD COLUMN IF NOT EXISTS email TEXT;
