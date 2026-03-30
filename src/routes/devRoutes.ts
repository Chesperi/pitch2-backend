import { Router, Request, Response } from "express";
import { pool } from "../db";
import { createMagicLinkForStaff } from "../services/authMagicLinkUrl";

const router = Router();

/**
 * Router SOLO PER USO DI SVILUPPO — endpoint di comodo per generare magic link.
 * In produzione (NODE_ENV === "production") le route rispondono 404 senza eseguire logica.
 */

router.post("/create-magic-link", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const { email } = req.body as { email?: unknown };
    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const emailNormalized = email.trim().toLowerCase();

    const staffResult = await pool.query<{
      id: number;
      email: string | null;
      active: boolean;
    }>(
      `SELECT id, email, active FROM staff WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [emailNormalized]
    );

    const staff = staffResult.rows[0];
    if (!staff) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    if (!staff.active) {
      res.status(403).json({ error: "Staff not active" });
      return;
    }

    const magicLoginUrl = await createMagicLinkForStaff(staff.id);

    res.status(200).json({
      staffId: staff.id,
      email: staff.email?.trim() ?? emailNormalized,
      magicLoginUrl,
    });
  } catch (err) {
    console.error("POST /api/dev/create-magic-link error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
