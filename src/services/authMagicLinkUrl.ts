import { createAuthMagicLink } from "./authMagicLinks";
import type { StaffId } from "../types/staffId";

/**
 * Genera un magic link per il login dello staff e restituisce l'URL assoluto.
 * Usato nelle email designazioni.
 */
export async function createMagicLinkForStaff(
  staffId: StaffId,
  redirectPath = "/designazioni"
): Promise<string> {
  const token = await createAuthMagicLink(staffId, redirectPath);
  // URL pubblico del backend (per il link nella mail che punta a GET /api/auth/magic-login)
  const baseUrl =
    process.env.PITCH2_API_URL ||
    process.env.PITCH_FREELANCE_BASE_URL ||
    "https://api.designazionipitch.com";
  return `${baseUrl.replace(/\/$/, "")}/api/auth/magic-login?token=${token}`;
}
