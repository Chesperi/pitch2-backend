import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "../config/supabase";

const CHECK_PASSWORD_PATH = "check_staff_password";
const SET_PASSWORD_PATH = "set_staff_password";

/**
 * Verifica la password dello staff tramite Edge Function Supabase check_staff_password.
 * La function accetta POST { staffId, password } e risponde 200 { ok: true | false }.
 */
export async function checkStaffPasswordWithSupabase(
  staffId: number,
  password: string
): Promise<boolean> {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${CHECK_PASSWORD_PATH}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ staffId, password }),
    });

    if (res.status !== 200) {
      const text = await res.text();
      console.error("check_staff_password error", { status: res.status, body: text });
      return false;
    }

    const body = (await res.json()) as { ok?: boolean };
    return Boolean(body.ok);
  } catch (err) {
    console.error("check_staff_password fetch error", err);
    return false;
  }
}

/**
 * Imposta la password dello staff tramite Edge Function Supabase set_staff_password.
 * La function accetta POST { staffId, password } e risponde 200 { success: true }.
 */
export async function setStaffPasswordWithSupabase(
  staffId: number,
  password: string
): Promise<boolean> {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${SET_PASSWORD_PATH}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ staffId, password }),
    });

    if (res.status !== 200) {
      const text = await res.text();
      console.error("set_staff_password error", { status: res.status, body: text });
      return false;
    }

    const body = (await res.json()) as { success?: boolean };
    return Boolean(body.success);
  } catch (err) {
    console.error("set_staff_password fetch error", err);
    return false;
  }
}
