import { DESIGNAZIONI_SENDER } from "../config/brevo";

export async function sendDesignazioniEmail(params: {
  toEmail: string;
  toName: string;
  subject: string;
  htmlContent: string;
}) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("Missing BREVO_API_KEY");
    return;
  }

  const body = {
    sender: DESIGNAZIONI_SENDER,
    to: [{ email: params.toEmail, name: params.toName }],
    subject: params.subject,
    htmlContent: params.htmlContent,
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let messageId: string | undefined;
  try {
    const json = JSON.parse(text);
    messageId = json.messageId;
  } catch {
    // ignore parse error
  }

  console.log("DESIGNAZIONI EMAIL SENT", {
    subject: params.subject,
    to: params.toEmail,
    sender: DESIGNAZIONI_SENDER.email,
    messageId: messageId ?? "(none)",
    status: res.status,
  });

  if (!res.ok) {
    console.error("Brevo send error", res.status, text);
  }
}

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  toName: string;
  resetUrl: string;
}) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("Missing BREVO_API_KEY");
    return;
  }

  const html = `
  <div style="font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #111;">
    <p>Ciao ${params.toName},</p>
    <p>Hai richiesto il reset della password per il tuo account PITCH.</p>
    <p>
      <a href="${params.resetUrl}" style="display:inline-block;padding:10px 18px;background:#f5c400;color:#000;text-decoration:none;font-weight:600;border-radius:4px;">
        Reimposta password
      </a>
    </p>
    <p style="font-size:12px;color:#666;">Il link scade tra 1 ora. Se non hai richiesto tu, ignora questa email.</p>
  </div>
  `;

  const body = {
    sender: DESIGNAZIONI_SENDER,
    to: [{ email: params.toEmail, name: params.toName }],
    subject: "Reimposta la tua password PITCH",
    htmlContent: html,
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log("PASSWORD RESET EMAIL SENT", {
    to: params.toEmail,
    status: res.status,
  });

  if (!res.ok) {
    console.error("Brevo send error", res.status, text);
  }
}

export async function sendInviteEmail(params: {
  toEmail: string;
  toName: string;
  inviteUrl: string;
}) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("Missing BREVO_API_KEY");
    return;
  }

  const html = `
  <div style="font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #111;">
    <p>Ciao ${params.toName},</p>
    <p>Sei stato invitato ad accedere a PITCH, il gestionale operativo DAZN.</p>
    <p>Clicca il pulsante qui sotto per creare la tua password e accedere.</p>
    <p>
      <a href="${params.inviteUrl}" style="display:inline-block;padding:10px 18px;background:#f5c400;color:#000;text-decoration:none;font-weight:600;border-radius:4px;">
        Crea la tua password
      </a>
    </p>
    <p style="font-size:12px;color:#666;">Il link scade tra 1 ora. Se non ti aspettavi questa email, ignorala.</p>
  </div>
  `;

  const body = {
    sender: DESIGNAZIONI_SENDER,
    to: [{ email: params.toEmail, name: params.toName }],
    subject: "Benvenuto in PITCH — crea la tua password",
    htmlContent: html,
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log("INVITE EMAIL SENT", {
    to: params.toEmail,
    status: res.status,
  });

  if (!res.ok) {
    console.error("Brevo send error", res.status, text);
  }
}
