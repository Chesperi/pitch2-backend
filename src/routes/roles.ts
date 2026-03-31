import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getCurrentSession } from "../auth/session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import { logAuditFromRequest } from "../services/auditLog";

const router = Router();

/** Risposta API: `code`/`name` sono alias di `role_code`/`description` per compatibilità client. */
export type Role = {
  id: number;
  code: string;
  name: string;
  location: string;
  description: string | null;
};

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
};

function normalizeDescription(
  description: string | null | undefined
): string | null {
  if (description == null) return null;
  const t = String(description).trim();
  return t === "" ? null : t;
}

function mapDbRowToRole(row: {
  id: number;
  role_code: string;
  location: string;
  description: string | null;
}): Role {
  const desc = row.description;
  return {
    id: row.id,
    code: row.role_code,
    name: desc?.trim() ? desc : row.role_code,
    location: row.location,
    description: desc,
  };
}

function roleChangedFields(before: Role, after: Role): string[] {
  const ch: string[] = [];
  if (before.code !== after.code) ch.push("roleCode");
  if (before.name !== after.name) ch.push("name");
  if (before.location !== after.location) ch.push("location");
  if ((before.description ?? null) !== (after.description ?? null)) {
    ch.push("description");
  }
  return ch;
}

router.get("/", async (_req, res) => {
  try {
    if (!(await requirePageRead(_req, res, "database"))) return;
    const result = await pool.query<{
      id: number;
      role_code: string;
      location: string;
      description: string | null;
    }>(
      `SELECT id, role_code, location, description
       FROM roles
       ORDER BY description ASC NULLS LAST, role_code ASC, location ASC`
    );
    res.json(result.rows.map(mapDbRowToRole));
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

    const fromName =
      typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
    const description =
      body.description !== undefined
        ? normalizeDescription(body.description)
        : fromName;

    const result = await pool.query<{
      id: number;
      role_code: string;
      location: string;
      description: string | null;
    }>(
      `INSERT INTO roles (role_code, location, description)
       VALUES ($1, $2, $3)
       RETURNING id, role_code, location, description`,
      [trimmedRoleCode, locRaw, description]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: "Insert returned no row" });
      return;
    }

    const apiRow = mapDbRowToRole(row);

    const session = getCurrentSession(req);
    void logAuditFromRequest(req, {
      actorType: session ? "staff" : "system",
      ...(session ? { actorId: session.staffId } : {}),
      entityType: "role",
      entityId: String(row.id),
      action: "create",
      metadata: {
        code: apiRow.code,
        name: apiRow.name,
        location: apiRow.location,
        description: apiRow.description,
      },
    });

    res.status(201).json(apiRow);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({
        error: "A role with this code and location already exists",
      });
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

    const existing = await pool.query<{
      id: number;
      role_code: string;
      location: string;
      description: string | null;
    }>(`SELECT id, role_code, location, description FROM roles WHERE id = $1`, [
      id,
    ]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Role not found" });
      return;
    }
    const before = mapDbRowToRole(existing.rows[0]);

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
      fields.push(`role_code = $${p++}`);
      values.push(t);
    }

    if (body.name !== undefined) {
      const t = typeof body.name === "string" ? body.name.trim() : "";
      if (!t) {
        res.status(400).json({ error: "name cannot be empty when provided" });
        return;
      }
      fields.push(`description = $${p++}`);
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

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    values.push(id);
    const result = await pool.query<{
      id: number;
      role_code: string;
      location: string;
      description: string | null;
    }>(
      `UPDATE roles SET ${fields.join(", ")} WHERE id = $${p} RETURNING id, role_code, location, description`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Role not found" });
      return;
    }

    const after = mapDbRowToRole(result.rows[0]);
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
          changedFields,
        },
      });
    }

    res.json(after);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({
        error: "A role with this code and location already exists",
      });
      return;
    }
    console.error("PATCH /api/roles/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
