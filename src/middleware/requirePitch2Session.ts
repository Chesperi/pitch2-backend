import { Request, Response, NextFunction } from "express";
import { getCurrentSession } from "../auth/session";

export interface AuthenticatedRequest extends Request {
  staffId: number;
}

/**
 * Middleware che richiede una sessione persistente (cookie pitch2_session).
 * Accetta solo type "persistent", non "magic".
 * Imposta req.staffId per i handler downstream.
 */
export function requirePitch2Session(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const session = getCurrentSession(req);

  if (!session || session.type !== "persistent") {
    res.status(401).json({ error: "Autenticazione richiesta" });
    return;
  }

  (req as AuthenticatedRequest).staffId = session.staffId;
  next();
}
