/**
 * Configurazione Supabase per PITCH_2.
 * Richiesta per Edge Functions (es. check_staff_password).
 */

export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function validateSupabaseConfig(): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Config Supabase mancante: imposta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY in .env"
    );
  }
}
