import type { Request, Response } from "express";
import { getCurrentSession } from "../auth/session";
import { getPageAccessLevel } from "../services/pagePermissions";

/** Consente `view` o `edit`; rifiuta `none` e sessione assente. */
export async function requirePageRead(
  req: Request,
  res: Response,
  pageKey: string
): Promise<boolean> {
  const session = getCurrentSession(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  const access = await getPageAccessLevel(session.staffId, pageKey);
  if (access === "none") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

/** Consente solo `edit`. */
export async function requirePageEdit(
  req: Request,
  res: Response,
  pageKey: string
): Promise<boolean> {
  const session = getCurrentSession(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  const access = await getPageAccessLevel(session.staffId, pageKey);
  if (access !== "edit") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}
