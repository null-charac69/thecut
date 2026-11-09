// Permanently deletes the calling user and everything they own.
// All public tables reference auth.users(id) ON DELETE CASCADE, so deleting the
// auth user wipes rows; this function additionally removes storage objects
// (which do not cascade) before deleting the user.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const BUCKET = "progress-photos";

async function listAll(admin: ReturnType<typeof createClient>, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id === null) out.push(...(await listAll(admin, path)));
    else out.push(path);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) return json({ error: "Not signed in" }, 401);
    const uid = u.user.id;

    let body: { confirm?: string } = {};
    try { body = await req.json(); } catch (_) { /* empty */ }
    if (body.confirm !== "DELETE") return json({ error: "Confirmation missing" }, 400);

    // 1) storage objects: everything under <uid>/ plus any path recorded in progress_photos
    const paths = new Set<string>(await listAll(admin, uid));
    const { data: photos } = await admin.from("progress_photos").select("storage_path").eq("user_id", uid);
    for (const p of photos ?? []) if (p.storage_path) paths.add(p.storage_path);
    const all = [...paths];
    for (let i = 0; i < all.length; i += 100) {
      const { error } = await admin.storage.from(BUCKET).remove(all.slice(i, i + 100));
      if (error) throw error;
    }

    // 2) the auth user; FK cascades remove every row in public.*
    const { error: de } = await admin.auth.admin.deleteUser(uid, false);
    if (de) throw de;
    return json({ ok: true, files_removed: all.length });
  } catch (e) {
    console.error("delete-account failed", e);
    return json({ error: (e as Error)?.message ?? "Delete failed" }, 500);
  }
});
