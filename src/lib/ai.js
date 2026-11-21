// Where the AI edge function runs. Pinned to Mumbai so the function, and the Bedrock model it calls, sit
// next to the user in India instead of wherever the request first lands.

/** Supabase region the AI function is forced to run in. */
export const AI_REGION = 'ap-south-1';

/**
 * URL of the AI edge function, pinned to a region.
 * @param {string} base Supabase project URL, e.g. https://xyz.supabase.co
 * @param {string} [region] Supabase region code
 * @returns {string}
 */
export function aiUrl(base, region = AI_REGION) {
  const u = String(base).replace(/\/+$/, '') + '/functions/v1/the-cut-ai';
  return region ? `${u}?forceFunctionRegion=${encodeURIComponent(region)}` : u;
}
