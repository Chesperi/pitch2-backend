import { Router } from "express";
import { pool } from "../db";

const router = Router();

export type Role = {
  id: number;
  code: string;
  name: string;
  location: string;
  description: string | null;
  active: boolean;
};

router.get("/", async (_req, res) => {
  try {
    const result = await pool.query<Role>(
      `SELECT id, code, name, location, description, active
       FROM roles
       ORDER BY name ASC, location ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/roles error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
