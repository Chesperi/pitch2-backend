import { Router, Request, Response } from "express";
import { pool } from "../db";
import { supabaseAdmin } from "../supabaseClient";
import { validateAndConsumeAuthMagicLink } from "../services/authMagicLinks";
import {
  checkStaffPasswordWithSupabase,
  setStaffPasswordWithSupabase,
} from "../services/supabaseAuth";
import {
  createPasswordResetToken,
  validatePasswordResetToken,
  getValidPasswordResetStaffId,
  markPasswordResetAsUsed,
} from "../services/passwordResets";
import { sendPasswordResetEmail } from "../services/brevo";
import {
  recordLoginAttempt,
  getLoginBlockInfo,
} from "../services/loginAttempts";
import {
  setMagicSession,
  clearMagicSession,
  setPersistentSession,
  createPitch2PersistentSession,
  getCurrentSession,
} from "../auth/session";
import {
  requirePitch2Session,
  AuthenticatedRequest,
} from "../middleware/requirePitch2Session";
import { getStaffProfileById } from "../services/staffService";
import { normalizeStaffId } from "../types/staffId";

const router = Router();
const APP_BASE =
  process.env.PITCH_FREELANCE_BASE_URL || "https://app.designazionipitch.com";
const FRONTEND_BASE =
  process.env.FRONTEND_BASE_URL ||
  process.env.PITCH_FREELANCE_BASE_URL ||
  "https://app.designazionipitch.com";

// GET /api/auth/me — profilo staff (richiede pitch2_session)
router.get(
  "/me",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      const staffId = (req as AuthenticatedRequest).staffId;
      const profile = await getStaffProfileById(staffId);
      if (!profile || !profile.active) {
        res.status(403).json({ error: "Staff not allowed" });
        return;
      }
      res.status(200).json({
        id: profile.id,
        email: profile.email,
        name: profile.name,
        surname: profile.surname,
        user_level: profile.user_level,
        active: profile.active,
        finance_visibility: profile.finance_visibility,
      });
    } catch (err) {
      console.error("GET /api/auth/me error:", err);
      res.status(500).json({ error: "Errore interno" });
    }
  }
);

// POST /api/auth/supabase/session — valida JWT, risolve staff per auth.users.id (UUID)
router.post("/supabase/session", async (req: Request, res: Response) => {
  try {
    const access_token = (req.body as { access_token?: unknown })?.access_token;
    if (typeof access_token !== "string" || !access_token.trim()) {
      res.status(400).json({ error: "access_token richiesto" });
      return;
    }

    if (!supabaseAdmin) {
      res.status(503).json({ error: "Supabase non configurato" });
      return;
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(
      access_token.trim()
    );
    if (userErr || !userData.user) {
      res.status(401).json({ error: "Token non valido" });
      return;
    }

    const supabaseUserId = normalizeStaffId(userData.user.id);
    const profile = await getStaffProfileById(supabaseUserId);
    if (!profile) {
      res.status(401).json({ error: "Staff non trovato o non attivo" });
      return;
    }

    // Cookie: sempre UUID Supabase (isStaffId), così coincide con auth.users.id e con supabase_id in DB.
    createPitch2PersistentSession(res, supabaseUserId, { rememberMe: true });

    res.status(200).json({ ok: true, staffId: supabaseUserId });
  } catch (err) {
    console.error("POST /api/auth/supabase/session error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

// GET /api/auth/magic-login?token=...
router.get("/magic-login", async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token ?? "").trim();
    if (!token) {
      redirectToInvalid(res);
      return;
    }

    const info = await validateAndConsumeAuthMagicLink(token);
    if (!info) {
      redirectToInvalid(res);
      return;
    }

    setMagicSession(res, info.staffId);

    const redirectUrl = `${APP_BASE.replace(/\/$/, "")}/magic-login${
      info.redirectPath ? `?redirect=${encodeURIComponent(info.redirectPath)}` : ""
    }`;
    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("GET /api/auth/magic-login error:", err);
    redirectToInvalid(res);
  }
});

// POST /api/auth/verify-password
router.post("/verify-password", async (req: Request, res: Response) => {
  try {
    const { password, rememberMe } = req.body as {
      password?: unknown;
      rememberMe?: boolean;
    };

    const session = getCurrentSession(req);
    if (!session || session.type !== "magic") {
      res.status(401).json({ error: "Magic link richiesto" });
      return;
    }

    if (typeof password !== "string" || !password.trim()) {
      res.status(400).json({ error: "Password obbligatoria" });
      return;
    }

    const staffId = session.staffId;
    const remember = rememberMe === true;

    const blockInfo = await getLoginBlockInfo(staffId);
    if (blockInfo.blocked) {
      console.log("PITCH2 VERIFY PASSWORD", {
        staffId,
        blocked: true,
        retryAfterSeconds: blockInfo.retryAfterSeconds,
      });
      return res.status(429).json({
        error: "Troppi tentativi di accesso. Riprova più tardi.",
        retryAfterSeconds: blockInfo.retryAfterSeconds,
      });
    }

    const ok = await checkStaffPasswordWithSupabase(staffId, password);
    console.log("PITCH2 VERIFY PASSWORD", {
      staffId,
      rememberMe: remember,
      ok,
      blocked: false,
    });

    if (!ok) {
      await recordLoginAttempt(staffId, false);
      res.status(401).json({ error: "Password non valida" });
      return;
    }

    await recordLoginAttempt(staffId, true);
    clearMagicSession(res);
    setPersistentSession(res, staffId, remember);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("POST /api/auth/verify-password error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

function redirectToInvalid(res: Response): void {
  const url = `${APP_BASE.replace(/\/$/, "")}/magic-link-invalid`;
  res.redirect(302, url);
}

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: unknown };

    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "Email obbligatoria" });
      return;
    }

    const emailTrimmed = email.trim().toLowerCase();
    const staffResult = await pool.query(
      `SELECT id, name, surname, email FROM staff WHERE LOWER(TRIM(email)) = $1`,
      [emailTrimmed]
    );

    const staff = staffResult.rows[0] as {
      id: string;
      name: string | null;
      surname: string | null;
      email: string | null;
    } | undefined;
    if (staff && staff.email?.trim()) {
      const token = await createPasswordResetToken(String(staff.id));
      const resetUrl = `${FRONTEND_BASE.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
      const staffName = `${staff.name ?? ""} ${staff.surname ?? ""}`.trim() || staff.email.trim();

      await sendPasswordResetEmail({
        toEmail: staff.email.trim(),
        toName: staffName,
        resetUrl,
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("POST /api/auth/forgot-password error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

// GET /api/auth/reset-password/validate?token=...
router.get("/reset-password/validate", async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token ?? "").trim();
    if (!token) {
      res.status(400).json({ valid: false, error: "Token mancante" });
      return;
    }

    const result = await validatePasswordResetToken(token);
    if (result.valid) {
      res.status(200).json({ valid: true });
      return;
    }

    res.status(200).json({ valid: false, error: result.error });
  } catch (err) {
    console.error("GET /api/auth/reset-password/validate error:", err);
    res.status(500).json({ valid: false, error: "Errore interno" });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body as { token?: unknown; password?: unknown };

    if (typeof token !== "string" || !token.trim()) {
      res.status(400).json({ error: "Dati mancanti" });
      return;
    }
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "Password obbligatoria (min 8 caratteri)" });
      return;
    }

    const staffId = await getValidPasswordResetStaffId(token.trim());
    if (!staffId) {
      res.status(400).json({ error: "Token non valido o scaduto" });
      return;
    }

    const ok = await setStaffPasswordWithSupabase(staffId, password);
    if (!ok) {
      res.status(500).json({ error: "Impossibile aggiornare la password" });
      return;
    }

    await markPasswordResetAsUsed(token.trim());
    setPersistentSession(res, staffId, true);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("POST /api/auth/reset-password error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

export default router;
