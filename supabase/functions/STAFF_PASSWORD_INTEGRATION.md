# Integrazione PITCH_2 con check_staff_password

<!-- TODO: PITCH_2 ora usa check_staff_password via checkStaffPasswordWithSupabase (src/services/supabaseAuth.ts) -->

PITCH_2 backend ora usa la Edge Function `check_staff_password` tramite `checkStaffPasswordWithSupabase` in `src/services/supabaseAuth.ts`.

Flusso:
1. Utente clicca magic link → sessione temporanea `pitch2_magic_session` con staffId
2. Frontend mostra form password + checkbox "Ricordami"
3. POST `/api/auth/verify-password` con `{ password, rememberMe }`
4. Backend chiama `checkStaffPasswordWithSupabase(staffId, password)` → fetch a `{SUPABASE_URL}/functions/v1/check_staff_password`
5. Se `{ ok: true }` → clear magic session, set `pitch2_session` (persistente), 200
6. Se `{ ok: false }` → 401 "Password non valida"
