import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../supabaseClient";
import { getStaffProfileById } from "../services/staffService";
import { normalizeStaffId } from "../types/staffId";

export interface SupabaseJwtRequest extends Request {
  supabaseUserId: string;
}

/**
 * Valida JWT Supabase da `Authorization: Bearer <access_token>`.
 * Richiede staff attivo come per POST /api/auth/supabase/session.
 */
export async function requireSupabaseJwt(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token JWT richiesto (Authorization: Bearer)" });
    return;
  }

  const accessToken = header.slice("Bearer ".length).trim();
  if (!accessToken) {
    res.status(401).json({ error: "Token mancante" });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Supabase non configurato" });
    return;
  }

  try {
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(
      accessToken
    );
    if (userErr || !userData.user) {
      res.status(401).json({ error: "Token non valido o scaduto" });
      return;
    }

    const supabaseUserId = normalizeStaffId(userData.user.id);
    const profile = await getStaffProfileById(supabaseUserId);
    if (!profile || !profile.active) {
      res.status(403).json({ error: "Staff non trovato o non attivo" });
      return;
    }

    (req as SupabaseJwtRequest).supabaseUserId = supabaseUserId;
    next();
  } catch (err) {
    console.error("requireSupabaseJwt error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
}
