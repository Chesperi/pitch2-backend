import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://prova:@localhost:5432/pitch2";

const pool = new Pool({ connectionString: DATABASE_URL });

const MIGRATIONS_DIR = path.join(__dirname, "../../db/migrations");

async function ensureSchemaMigrationsTable(client: import("pg").PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(
  client: import("pg").PoolClient
): Promise<Set<string>> {
  const result = await client.query(
    "SELECT filename FROM schema_migrations"
  );
  return new Set(result.rows.map((r) => r.filename));
}

async function runMigration(
  client: import("pg").PoolClient,
  filename: string,
  sql: string
) {
  await client.query(sql);
  await client.query(
    "INSERT INTO schema_migrations (filename) VALUES ($1)",
    [filename]
  );
}

async function main() {
  const client = await pool.connect();

  try {
    await ensureSchemaMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs.readdirSync(MIGRATIONS_DIR);
    const sqlFiles = files
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const filename of sqlFiles) {
      if (applied.has(filename)) {
        console.log(`[skip] ${filename} (already applied)`);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filePath, "utf-8");

      console.log(`[run] ${filename}`);
      await runMigration(client, filename, sql);
      console.log(`[ok]  ${filename}`);
    }

    console.log("Migrations complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
