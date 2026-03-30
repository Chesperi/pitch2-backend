import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getCurrentSession } from "../auth/session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import { logAuditFromRequest } from "../services/auditLog";

const router = Router();

/** Shape JSON di GET/POST/PATCH: colonne DB `code` / `name` / `location` / … */
export type Role = {
  id: number;
  code: string;
  name: string;
  location: string;
  description: string | null;
  active: boolean;
};

/** Dominio `roles.location` allineato ai valori usati in anagrafica (estendere se servono altre sedi). */
const ALLOWED_LOCATIONS = ["STADIO", "COLOGNO", "LEEDS", "REMOTE"] as const;

type AllowedLocation = (typeof ALLOWED_LOCATIONS)[number];

function isAllowedLocation(v: string): v is AllowedLocation {
  return (ALLOWED_LOCATIONS as readonly string[]).includes(v);
}

type RoleBody = {
  roleCode?: string;
  name?: string;
  location?: string;
  description?: string | null;
  active?: boolean;
};

function normalizeDescription(
  description: string | null | undefined
): string | null {
  if (description == null) return null;
  const t = String(description).trim();
  return t === "" ? null : t;
}

function roleChangedFields(before: Role, after: Role): string[] {
  const ch: string[] = [];
  if (before.code !== after.code) ch.push("roleCode");
  if (before.name !== after.name) ch.push("name");
  if (before.location !== after.location) ch.push("location");
  if ((before.description ?? null) !== (after.description ?? null)) {
    ch.push("description");
  }
  if (before.active !== after.active) ch.push("active");
  return ch;
}

router.get("/", async (_req, res) => {
  try {
    if (!(await requirePageRead(_req, res, "database"))) return;
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

router.post("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;
    const body = req.body as RoleBody;
    const trimmedRoleCode =
      typeof body.roleCode === "string" ? body.roleCode.trim() : "";
    if (!trimmedRoleCode) {
      res.status(400).json({ error: "roleCode is required and must be non-empty" });
      return;
    }

    const locRaw =
      typeof body.location === "string" ? body.location.trim().toUpperCase() : "";
    if (!locRaw || !isAllowedLocation(locRaw)) {
      res.status(400).json({
        error: `location must be one of: ${ALLOWED_LOCATIONS.join(", ")}`,
      });
      return;
    }

    const description = normalizeDescription(body.description);
    const active = body.active === false ? false : true;
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : trimmedRoleCode;

    const result = await pool.query<Role>(
      `INSERT INTO roles (code, name, location, description, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, location, description, active`,
      [trimmedRoleCode, name, locRaw, description, active]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: "Insert returned no row" });
      return;
    }

    const session = getCurrentSession(req);
    void logAuditFromRequest(req, {
      actorType: session ? "staff" : "system",
      ...(session ? { actorId: session.staffId } : {}),
      entityType: "role",
      entityId: String(row.id),
      action: "create",
      metadata: {
        code: row.code,
        name: row.name,
        location: row.location,
        description: row.description,
        active: row.active,
      },
    });

    res.status(201).json(row);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({ error: "A role with this code already exists" });
      return;
    }
    console.error("POST /api/roles error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid role id" });
      return;
    }

    const existing = await pool.query<Role>(
      `SELECT id, code, name, location, description, active FROM roles WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Role not found" });
      return;
    }
    const before = existing.rows[0];

    const body = req.body as RoleBody;
    const fields: string[] = [];
    const values: unknown[] = [];
    let p = 1;

    if (body.roleCode !== undefined) {
      const t =
        typeof body.roleCode === "string" ? body.roleCode.trim() : "";
      if (!t) {
        res.status(400).json({ error: "roleCode cannot be empty" });
        return;
      }
      fields.push(`code = $${p++}`);
      values.push(t);
    }

    if (body.name !== undefined) {
      const t = typeof body.name === "string" ? body.name.trim() : "";
      if (!t) {
        res.status(400).json({ error: "name cannot be empty when provided" });
        return;
      }
      fields.push(`name = $${p++}`);
      values.push(t);
    }

    if (body.location !== undefined) {
      const locRaw =
        typeof body.location === "string"
          ? body.location.trim().toUpperCase()
          : "";
      if (!locRaw || !isAllowedLocation(locRaw)) {
        res.status(400).json({
          error: `location must be one of: ${ALLOWED_LOCATIONS.join(", ")}`,
        });
        return;
      }
      fields.push(`location = $${p++}`);
      values.push(locRaw);
    }

    if (body.description !== undefined) {
      fields.push(`description = $${p++}`);
      values.push(normalizeDescription(body.description));
    }

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        res.status(400).json({ error: "active must be a boolean" });
        return;
      }
      fields.push(`active = $${p++}`);
      values.push(body.active);
    }

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    values.push(id);
    const result = await pool.query<Role>(
      `UPDATE roles SET ${fields.join(", ")} WHERE id = $${p} RETURNING id, code, name, location, description, active`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Role not found" });
      return;
    }

    const after = result.rows[0];
    const changedFields = roleChangedFields(before, after);
    if (changedFields.length > 0) {
      const session = getCurrentSession(req);
      void logAuditFromRequest(req, {
        actorType: session ? "staff" : "system",
        ...(session ? { actorId: session.staffId } : {}),
        entityType: "role",
        entityId: String(after.id),
        action: "update",
        metadata: {
          code: after.code,
          name: after.name,
          location: after.location,
          description: after.description,
          active: after.active,
          changedFields,
        },
      });
    }

    res.json(after);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({ error: "A role with this code already exists" });
      return;
    }
    console.error("PATCH /api/roles/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
