import type { NextFunction, Request, Response } from "express";
import { getCurrentSession } from "../auth/session";
import { getStaffProfileById } from "../services/staffService";

export type FinanceVisibility = "HIDDEN" | "VISIBLE";

export type FinanceStaffLike = {
  user_level: string;
  finance_visibility: FinanceVisibility;
};

export function canSeeFinance(staff: FinanceStaffLike): boolean {
  const alwaysVisible = ["MANAGER", "MASTER"];
  if (alwaysVisible.includes(String(staff.user_level ?? "").toUpperCase())) {
    return true;
  }
  // TODO: in futuro integrare finance_access_override quando verra' usato nel runtime.
  return staff.finance_visibility === "VISIBLE";
}

export async function getFinanceAccessForRequest(req: Request): Promise<boolean> {
  const reqAny = req as Request & {
    staff?: FinanceStaffLike;
    staffId?: string;
    supabaseUserId?: string;
  };

  if (reqAny.staff) {
    return canSeeFinance(reqAny.staff);
  }

  const staffKey =
    reqAny.staffId ??
    reqAny.supabaseUserId ??
    getCurrentSession(req)?.staffId ??
    null;
  if (!staffKey) return false;

  const profile = await getStaffProfileById(String(staffKey));
  if (!profile || !profile.active) return false;
  return canSeeFinance(profile);
}

export async function requireFinanceAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const reqAny = req as Request & { staff?: FinanceStaffLike };
  if (reqAny.staff && canSeeFinance(reqAny.staff)) {
    next();
    return;
  }

  const allowed = await getFinanceAccessForRequest(req);
  if (!allowed) {
    res.status(403).json({ error: "Finance access denied" });
    return;
  }
  next();
}
