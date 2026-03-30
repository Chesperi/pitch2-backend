import { Router } from "express";
import { resolveMagicLinkToken } from "../services/magicLinks";

const router = Router();

router.get("/resolve", async (req, res, next) => {
  try {
    const token = String(req.query.token ?? "");
    if (!token) return res.status(400).json({ error: "Missing token" });

    const info = await resolveMagicLinkToken(token);
    if (!info) return res.status(404).json({ error: "Invalid or expired token" });

    return res.json(info); // { staffId: number }
  } catch (err) {
    next(err);
  }
});

export default router;
