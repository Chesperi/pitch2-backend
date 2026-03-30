import dns from "node:dns";
import { Pool } from "pg";

// Prima di qualsiasi connessione TCP/pg: preferisci A record (IPv4) rispetto ad AAAA,
// così su bridge Docker senza route IPv6 verso Internet non si usa l’IPv6 di Supabase.
dns.setDefaultResultOrder("ipv4first");

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is required in production. Use the Postgres URI from Supabase (Settings → Database), e.g. postgresql://postgres:...@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
    );
  }
  return "postgres://prova:@localhost:5432/pitch2";
}

const connectionString = resolveDatabaseUrl();

export const pool = new Pool({
  connectionString,
});
