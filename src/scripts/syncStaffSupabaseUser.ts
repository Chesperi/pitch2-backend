/**
 * Riallinea Supabase Auth con un record staff (metadata staff_id, nome, ecc.).
 *
 * Uso (dalla root del repo, con .env caricato):
 *   npx ts-node -r dotenv/config src/scripts/syncStaffSupabaseUser.ts <staff_id>
 *
 * Esempio:
 *   npx ts-node -r dotenv/config src/scripts/syncStaffSupabaseUser.ts 1
 */
import "dotenv/config";
import { pool } from "../db";
import { syncSupabaseUserMetadataForStaff } from "../services/staffSupabase";

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isFinite(id) || id < 1) {
    console.error("Usage: ts-node syncStaffSupabaseUser.ts <staff_id>");
    process.exit(1);
  }

  const { rows } = await pool.query<{
    id: number;
    email: string | null;
    name: string | null;
    surname: string | null;
  }>(
    `SELECT id, email, name, surname FROM staff WHERE id = $1`,
    [id]
  );
  const staff = rows[0];
  if (!staff) {
    console.error(`No staff row for id=${id}`);
    process.exit(1);
  }
  if (!staff.email?.trim()) {
    console.error(`Staff ${id} has no email; cannot sync Supabase user.`);
    process.exit(1);
  }

  const out = await syncSupabaseUserMetadataForStaff({
    id: staff.id,
    email: staff.email,
    name: staff.name,
    surname: staff.surname,
  });

  if (out) {
    console.log("OK", { staffId: staff.id, supabaseUserId: out.id, email: staff.email });
  } else {
    console.warn(
      "No Supabase user created or found by email. Check SUPABASE_* env and Auth users list."
    );
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
