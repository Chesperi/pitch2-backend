import { pool } from "../db";

const BLOCK_WINDOW_SECONDS = 600; // 10 minuti
const MAX_FAILED_ATTEMPTS = 3;

export async function recordLoginAttempt(
  staffId: number,
  success: boolean
): Promise<void> {
  await pool.query(
    `INSERT INTO auth_login_attempts (staff_id, success) VALUES ($1, $2)`,
    [staffId, success]
  );
}

export async function getLoginBlockInfo(
  staffId: number
): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const since = new Date(Date.now() - BLOCK_WINDOW_SECONDS * 1000);

  const result = await pool.query(
    `SELECT attempted_at FROM auth_login_attempts
     WHERE staff_id = $1 AND attempted_at >= $2 AND success = false
     ORDER BY attempted_at DESC`,
    [staffId, since]
  );

  const failed = result.rows as { attempted_at: Date | string }[];
  if (failed.length < MAX_FAILED_ATTEMPTS) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const lastFailed = failed[0];
  const lastFailedAt =
    typeof lastFailed.attempted_at === "string"
      ? new Date(lastFailed.attempted_at).getTime()
      : lastFailed.attempted_at.getTime();
  const secondsPassed = Math.floor((Date.now() - lastFailedAt) / 1000);
  const retryAfter = BLOCK_WINDOW_SECONDS - secondsPassed;

  if (retryAfter <= 0) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  return { blocked: true, retryAfterSeconds: retryAfter };
}
