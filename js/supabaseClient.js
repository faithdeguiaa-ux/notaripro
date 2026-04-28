// /js/supabaseClient.js
// Initializes the Supabase JS client.
// Reads SUPABASE_URL and SUPABASE_ANON_KEY from window.SUPABASE_CONFIG,
// which is written at build time by /scripts/build-config.js (Vercel)
// or copied locally from /js/config.example.js -> /js/config.js.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cfg = window.SUPABASE_CONFIG || {};

if (!cfg.url || !cfg.anonKey) {
  console.error(
    '[eNotaryo] Missing Supabase config. Copy js/config.example.js to js/config.js ' +
    'and fill in your SUPABASE_URL and SUPABASE_ANON_KEY, or set them as Vercel env vars.'
  );
}

export const supabase = createClient(cfg.url || '', cfg.anonKey || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'enotaryo-auth'
  }
});
