import type { Request } from "express";
import { pool } from "../db";
import type { StaffId } from "../types/staffId";
import { isStaffId, normalizeStaffId } from "../types/staffId";

export type ActorType = "staff" | "system";

export interface AuditLogInput {
  actorType: ActorType;
  /** Obbligatorio se `actorType === "staff"`; ignorato se `system`. */
  actorId?: StaffId;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: unknown;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

function validateInput(input: AuditLogInput): string | null {
  if (input.actorType !== "staff" && input.actorType !== "system") {
    return `audit: invalid actorType "${String(input.actorType)}"`;
  }
  if (input.actorType === "staff" && !isStaffId(input.actorId)) {
    return "audit: actorType staff requires a valid StaffId (UUID)";
  }
  const et = String(input.entityType ?? "").trim();
  const eid = String(input.entityId ?? "").trim();
  const act = String(input.action ?? "").trim();
  if (!et) return "audit: entityType is required";
  if (!eid) return "audit: entityId is required";
  if (!act) return "audit: action is required";
  return null;
}

/**
 * Scrive una riga su `audit_log`. Non propaga errori: in caso di fallimento logga e termina.
 * Usare da route/service senza `await` se si vuole fire-and-forget (es. `void logAuditEntry(...)`).
 */
export async function logAuditEntry(input: AuditLogInput): Promise<void> {
  const validationError = validateInput(input);
  if (validationError) {
    console.warn("[audit_log]", validationError, { input });
    return;
  }

  const actor_id =
    input.actorType === "staff" && isStaffId(input.actorId)
      ? normalizeStaffId(input.actorId)
      : null;

  const metadata =
    input.metadata !== undefined && input.metadata !== null
      ? input.metadata
      : {};

  let metadataJson: string;
  try {
    metadataJson = JSON.stringify(metadata);
  } catch (e) {
    console.warn("[audit_log] metadata JSON.stringify failed:", e, { input });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO audit_log (
        actor_type, actor_id, entity_type, entity_id, action,
        metadata, request_id, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        input.actorType,
        actor_id,
        String(input.entityType).trim(),
        String(input.entityId).trim(),
        String(input.action).trim(),
        metadataJson,
        input.requestId?.trim() || null,
        input.ipAddress?.trim() || null,
        input.userAgent?.trim() || null,
      ]
    );
  } catch (err) {
    console.warn(
      "[audit_log] insert failed:",
      err instanceof Error ? err.message : err
    );
  }
}

type AuditPayloadFromRequest = Omit<
  AuditLogInput,
  "requestId" | "ipAddress" | "userAgent"
>;

/**
 * Come `logAuditEntry`, arricchito con dati tipici della richiesta HTTP.
 * `request_id`: header `x-request-id` o `X-Request-Id` se presente (nessun middleware dedicato nel progetto al momento).
 */
export async function logAuditFromRequest(
  req: Request,
  payload: AuditPayloadFromRequest
): Promise<void> {
  const requestId =
    req.get("x-request-id")?.trim() ||
    req.get("X-Request-Id")?.trim() ||
    undefined;
  const ip =
    (typeof req.ip === "string" && req.ip ? req.ip : undefined) ||
    req.socket?.remoteAddress ||
    undefined;
  const userAgent = req.get("user-agent")?.trim() || undefined;

  return logAuditEntry({
    ...payload,
    requestId,
    ipAddress: ip,
    userAgent,
  });
}
