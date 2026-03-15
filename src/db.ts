import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://prova:@localhost:5432/pitch2";

export const pool = new Pool({
  connectionString: DATABASE_URL,
});
