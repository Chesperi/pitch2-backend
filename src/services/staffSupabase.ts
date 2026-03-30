import { supabaseAdmin } from "../supabaseClient";

export type StaffInfo = {
  id: number;
  email: string | null;
  name: string | null;
  surname: string | null;
};

/**
 * Crea o sincronizza l'utente Supabase per uno staff freelance.
 * Se l'email è già registrata, non solleva errore.
 */
export async function ensureSupabaseUserForStaff(
  staff: StaffInfo
): Promise<{ id: string } | null> {
  if (!staff.email?.trim()) return null;
  if (!supabaseAdmin) return null;

  const fullName = [staff.name, staff.surname].filter(Boolean).join(" ");

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: staff.email.trim(),
    email_confirm: true,
    user_metadata: {
      staff_id: staff.id,
      name: staff.name,
      surname: staff.surname,
      full_name: fullName,
    },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("already registered") ||
      msg.includes("already exists") ||
      msg.includes("duplicate")
    ) {
      return null;
    }
    throw error;
  }

  return data?.user ? { id: data.user.id } : null;
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  const maxPages = 50;

  while (page <= maxPages) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error || !data?.users?.length) break;
    const match = data.users.find(
      (u) => u.email?.trim().toLowerCase() === normalized
    );
    if (match) return match.id;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

/**
 * Come ensureSupabaseUserForStaff, ma se l'utente esiste già in Auth aggiorna
 * user_metadata (es. staff_id) invece di ignorare il caso.
 */
export async function syncSupabaseUserMetadataForStaff(
  staff: StaffInfo
): Promise<{ id: string } | null> {
  const created = await ensureSupabaseUserForStaff(staff);
  if (created) return created;
  if (!staff.email?.trim() || !supabaseAdmin) return null;

  const uid = await findAuthUserIdByEmail(staff.email.trim());
  if (!uid) return null;

  const fullName = [staff.name, staff.surname].filter(Boolean).join(" ");
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(uid, {
    user_metadata: {
      staff_id: staff.id,
      name: staff.name,
      surname: staff.surname,
      full_name: fullName,
    },
  });
  if (error) throw error;
  return data.user ? { id: data.user.id } : null;
}
