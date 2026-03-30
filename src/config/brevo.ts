/**
 * Configurazione Brevo per email designazioni.
 * Posizionata in src/config/brevo.ts per centralizzare il mittente.
 *
 * Per sovrascrivere in futuro: imposta BREVO_SENDER_EMAIL e BREVO_SENDER_NAME nell'.env
 */
export const DESIGNAZIONI_SENDER = {
  email: process.env.BREVO_SENDER_EMAIL ?? "dazn@designazionipitch.com",
  name: process.env.BREVO_SENDER_NAME ?? "DAZN Designazioni PITCH",
};
