import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const email = "andrea.andrisano47@gmail.com";
  const staffId = 1;

  const { data: staff, error: staffErr } = await supabase
    .from("staff")
    .select("name, surname")
    .eq("id", staffId)
    .single();

  if (staffErr || !staff) {
    console.error("Errore nel leggere staff:", staffErr);
    process.exit(1);
  }

  const { data: usersPage, error: usersErr } =
    await supabase.auth.admin.listUsers();

  if (usersErr) {
    console.error("Errore listUsers:", usersErr);
    process.exit(1);
  }

  const authUser = usersPage.users.find((u) => u.email === email);
  if (!authUser) {
    console.error("Auth user non trovato per email", email);
    process.exit(1);
  }

  const fullName = `${staff.name} ${staff.surname}`.trim();

  const { error: updErr } = await supabase.auth.admin.updateUserById(
    authUser.id,
    {
      user_metadata: {
        staff_id: staffId,
        name: staff.name,
        surname: staff.surname,
        full_name: fullName,
        email_verified: true,
      },
    }
  );

  if (updErr) {
    console.error("Errore updateUserById:", updErr);
    process.exit(1);
  }

  console.log("Updated user_metadata for:", authUser.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
