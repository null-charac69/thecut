import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export const SUPABASE_URL = 'https://ukyobppectpjkcudgewy.supabase.co';

export const SUPABASE_KEY = 'sb_publishable_Lm9JVKNstznjU-r9NGCZEw_YQE0ASeO';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const $ = (s) => document.querySelector(s);

export const pwc = (p) => 'pw-' + Math.max(0, Math.min(100, Math.round(Number(p) || 0)));

export async function q(p) {
  let { data, error } = await p;
  if (error) throw error;
  return data;
}
