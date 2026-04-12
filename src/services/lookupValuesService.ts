import { pool } from "../db";
import type {
  CreateLookupValuePayload,
  LookupValue,
  UpdateLookupValuePayload,
} from "../types";

function mapRowToLookupValue(row: Record<string, unknown>): LookupValue {
  return {
    id: Number(row.id),
    category: String(row.category ?? ""),
    value: String(row.value ?? ""),
    sort_order: Number(row.sort_order ?? 0),
    created_at: String(row.created_at ?? ""),
  };
}

export async function listLookupValues(
  category?: string
): Promise<LookupValue[]> {
  const cat = category?.trim();
  if (cat) {
    const result = await pool.query(
      `SELECT id, category, value, sort_order, created_at
       FROM lookup_values
       WHERE category = $1
       ORDER BY sort_order ASC, value ASC`,
      [cat]
    );
    return result.rows.map((r) =>
      mapRowToLookupValue(r as Record<string, unknown>)
    );
  }
  const result = await pool.query(
    `SELECT id, category, value, sort_order, created_at
     FROM lookup_values
     ORDER BY sort_order ASC, value ASC`
  );
  return result.rows.map((r) =>
    mapRowToLookupValue(r as Record<string, unknown>)
  );
}

export async function createLookupValue(
  payload: CreateLookupValuePayload
): Promise<LookupValue> {
  const category = payload.category.trim();
  const value = payload.value.trim();
  if (!category || !value) {
    throw new Error("category e value sono obbligatori");
  }

  const dup = await pool.query(
    `SELECT 1 FROM lookup_values WHERE category = $1 AND value = $2 LIMIT 1`,
    [category, value]
  );
  if ((dup.rowCount ?? 0) > 0) {
    throw new Error("Valore già esistente in questa categoria");
  }

  const sortOrder =
    payload.sort_order != null && !Number.isNaN(Number(payload.sort_order))
      ? Number(payload.sort_order)
      : 0;

  const result = await pool.query(
    `INSERT INTO lookup_values (category, value, sort_order)
     VALUES ($1, $2, $3)
     RETURNING id, category, value, sort_order, created_at`,
    [category, value, sortOrder]
  );
  return mapRowToLookupValue(result.rows[0] as Record<string, unknown>);
}

export async function updateLookupValue(
  id: number,
  payload: UpdateLookupValuePayload
): Promise<LookupValue | null> {
  const existing = await pool.query(
    `SELECT id, category, value, sort_order, created_at
     FROM lookup_values WHERE id = $1`,
    [id]
  );
  if (existing.rows.length === 0) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  const set = (col: string, val: unknown) => {
    fields.push(`${col} = $${p++}`);
    values.push(val);
  };

  if (payload.category !== undefined) {
    set("category", payload.category.trim());
  }
  if (payload.value !== undefined) {
    set("value", payload.value.trim());
  }
  if (payload.sort_order !== undefined) {
    set("sort_order", Number(payload.sort_order));
  }

  if (fields.length === 0) {
    return mapRowToLookupValue(existing.rows[0] as Record<string, unknown>);
  }

  const nextCategory =
    payload.category !== undefined
      ? payload.category.trim()
      : String(existing.rows[0].category);
  const nextValue =
    payload.value !== undefined
      ? payload.value.trim()
      : String(existing.rows[0].value);

  const conflict = await pool.query(
    `SELECT 1 FROM lookup_values
     WHERE category = $1 AND value = $2 AND id <> $3 LIMIT 1`,
    [nextCategory, nextValue, id]
  );
  if ((conflict.rowCount ?? 0) > 0) {
    throw new Error("Valore già esistente in questa categoria");
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE lookup_values SET ${fields.join(", ")} WHERE id = $${p} RETURNING id, category, value, sort_order, created_at`,
    values
  );
  if (result.rows.length === 0) return null;
  return mapRowToLookupValue(result.rows[0] as Record<string, unknown>);
}

export async function deleteLookupValue(id: number): Promise<boolean> {
  const result = await pool.query(`DELETE FROM lookup_values WHERE id = $1`, [
    id,
  ]);
  return (result.rowCount ?? 0) > 0;
}
