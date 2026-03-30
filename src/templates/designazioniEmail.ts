export type DesignazioniEmailEvent = {
  competition: string; // es: "SERIE A"
  matchTitle: string; // es: "Fiorentina vs Inter"
  dateLine: string; // es: "domenica 22 marzo 2026 — KO: 20:45 — PRE: 45 min"
  roleLine: string; // es: "Ruolo: ... | Standard: ..."
};

export function renderDesignazioniEmail(opts: {
  staffName: string; // "Andrea Andrisano"
  events: DesignazioniEmailEvent[];
  magicUrl: string; // link a /freelance?token=...
}) {
  const eventsHtml = opts.events
    .map(
      (e) => `
      <section style="padding:24px 0;border-top:1px solid #111;">
        <div style="font-size:11px;letter-spacing:2px;color:#777;margin-bottom:4px;text-transform:uppercase;">
          ${e.competition}
        </div>
        <div style="font-size:24px;font-weight:700;margin-bottom:8px;">
          ${e.matchTitle}
        </div>
        <div style="font-size:14px;margin-bottom:4px;">
          ${e.dateLine}
        </div>
        <div style="font-size:14px;color:#444;">
          ${e.roleLine}
        </div>
      </section>
    `
    )
    .join("");

  return `
  <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#ffffff; color:#111111; padding:24px;">
    <header style="font-size:10px;letter-spacing:4px;font-weight:600;margin-bottom:24px;text-transform:uppercase;">
      DAZN
    </header>

    <h1 style="font-size:28px;margin:0 0 24px 0;">Designazioni</h1>

    <div style="border-top:2px solid #111111;margin:0 0 24px 0;"></div>

    <p style="font-size:16px;margin:0 0 8px 0;">
      Ciao <strong>${opts.staffName}</strong>,
    </p>
    <p style="font-size:14px;margin:0 0 24px 0;">
      Di seguito il riepilogo delle tue prossime designazioni aggiornate.
    </p>

    ${eventsHtml}

    <div style="border-top:2px solid #111111;margin:24px 0;"></div>

    <p style="font-size:14px;margin:0 0 16px 0;">
      Accedi a Pitch per confermare le tue disponibilità.
    </p>

    <p>
      <a href="${opts.magicUrl}"
         style="display:inline-block;padding:10px 18px;
                background:#f5c400;color:#000000;
                text-decoration:none;font-weight:600;
                border-radius:4px;">
        Accedi alla tua area Pitch
      </a>
    </p>
  </div>
  `;
}
