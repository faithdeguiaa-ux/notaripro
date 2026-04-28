// scripts/build-config.js
// Runs at Vercel build time. Writes /js/config.js from environment vars.
// Locally, you can either run `node scripts/build-config.js` (with the env
// vars set) or just copy /js/config.example.js to /js/config.js by hand.

const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  console.error(
    '[build-config] Missing SUPABASE_URL or SUPABASE_ANON_KEY. ' +
    'Set them in Vercel project env settings (Production / Preview / Development).'
  );
  process.exit(1);
}

const out = `// AUTO-GENERATED — DO NOT EDIT. Sourced from Vercel env vars.
window.SUPABASE_CONFIG = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)}
};
`;

const target = path.join(__dirname, '..', 'js', 'config.js');
fs.writeFileSync(target, out, 'utf8');
console.log('[build-config] wrote', target);
