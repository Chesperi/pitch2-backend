/** Chiave primaria `staff` (UUID), allineata a `auth.users.id` dove applicabile. */
export type StaffId = string;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStaffId(value: unknown): value is StaffId {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function normalizeStaffId(value: string): StaffId {
  return value.trim().toLowerCase();
}
