# NotariPro

Digital notary for Philippine lawyers, aligned with the Supreme Court's 2025 Amendments to the 2004 Rules on Notarial Practice (A.M. No. 02-8-13-SC).

Stack: HTML + Tailwind + vanilla JS · Supabase (Auth, Postgres, Storage) · Vercel.

## File structure

```
/index.html                     — landing page (public)
/app.html                       — app shell + UI (sidebar, 6 views, auth-gated)
/NotariPro-demo.html            — single-file offline demo (localStorage backend)
/js/
  app.js                        — orchestration, view routing, wizard, audit log
  auth.js                       — Supabase auth + lawyer profile
  register.js                   — Notarial Register: list, create, counters, filename
  storage.js                    — PDF upload to 'notarial-documents' bucket
  emailQueue.js                 — insert into email_dispatch_queue
  audit.js                      — audit_logs writes + reads
  ocr.js                        — extractDocumentMetadata() — STUB
  supabaseClient.js             — initializes the JS client from window.SUPABASE_CONFIG
  config.example.js             — template for js/config.js (gitignored)
/sql/
  schema.sql                    — tables, indexes, FKs, triggers, storage bucket
  policies.sql                  — RLS for tables + storage
/scripts/
  build-config.js               — Vercel build step: writes js/config.js from env vars
package.json
vercel.json
.env.example
.gitignore
```

## Routing

- `/` → `index.html` — public landing page
- `/app` → `app.html` — auth-gated application (login + dashboard + register + outbox + audit + settings)
- `/NotariPro-demo.html` — offline single-file demo (localStorage)

Vercel serves clean URLs (`cleanUrls: true` in `vercel.json`), so `/app` resolves without the `.html` extension.

## Setup

### 1. Supabase project

1. Create a new project at https://supabase.com.
2. In the SQL Editor, paste and run `sql/schema.sql`.
3. In the SQL Editor, paste and run `sql/policies.sql`.
4. (Storage > Buckets) confirm `notarial-documents` exists and is **private**.
5. (Auth > URL Configuration) add your Vercel production URL to **Site URL** and **Redirect URLs**.
6. (Auth > Providers > Email) for beta testing you can disable "Confirm email" to skip the email click-through; flip back on for production.
7. (Project Settings > API) copy the **Project URL** and **anon public** key.

### 2. Local dev

```bash
git clone <your-repo>
cd "DIGITAL NOTARIAL SERVICE"
cp js/config.example.js js/config.js
# edit js/config.js with your Supabase URL + anon key
npx serve .         # or: python3 -m http.server 3000
# open http://localhost:3000
```

> ES modules require a real HTTP server — opening `index.html` via `file://` will fail to load `/js/app.js`.

### 3. Offline demo (no Supabase needed)

`NotariPro-demo.html` is a single self-contained file with a localStorage-backed fake backend. Just double-click to open in a browser. Sign up creates a real (browser-local) account, and register entries / audit log persist across reloads. The banner "Reset demo data" button wipes state.

### 4. GitHub

```bash
git init
git add .
git commit -m "Initial: NotariPro"
git branch -M main
git remote add origin git@github.com:YOUR-ORG/notaripro.git
git push -u origin main
```

`js/config.js` is gitignored — your keys never leave your machine.

### 5. Vercel deployment

1. Import your GitHub repo in Vercel.
2. Framework preset: **Other** (no framework). Output directory: `.`.
3. Project Settings > Environment Variables, add for **all environments**:
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_ANON_KEY` = your Supabase anon (public) key
4. Deploy. Vercel runs `node scripts/build-config.js`, which writes `/js/config.js` from those env vars.
5. After first deploy, copy the production URL back into Supabase **Auth > URL Configuration** as both Site URL and a redirect URL pattern (`https://yourapp.vercel.app/**`).

## What's implemented

- Email/password auth, persistent sessions, sign-out, `getCurrentProfile()`.
- Lawyer profile auto-created on signup via `on_auth_user_created` trigger.
- Schema: `lawyers`, `documents`, `register_entries`, `email_dispatch_queue`, `audit_logs`.
- RLS on every table, scoped to `auth.uid()`.
- Private storage bucket `notarial-documents` with per-user folder prefix RLS.
- PDF upload pipeline (`uploadPdf`) inserting a `documents` row + signed URL.
- `createEntry()` reads counters, generates filename from token pattern, inserts row, advances counters atomically per user.
- Register table loads live from DB with search / type / month filters and CSV export.
- Email outbox lists `email_dispatch_queue` rows; "Send all queued" + per-item "Send now" mark items as dispatched.
- Audit Log view: filterable, color-coded badges (Notarize / Upload / Email / Signup / Login / Logout).
- Audit logging on login, logout, signup, file upload, register entry, email queued, profile update.
- OCR stub: `extractDocumentMetadata(file)` returns one of three sample shapes based on filename hints.

## What's intentionally not implemented (next sprints)

- Real OCR — replace `js/ocr.js`'s body with a Claude Vision call (or Supabase Edge Function calling Anthropic).
- External email send — add a Supabase Edge Function on a cron schedule that consumes `email_dispatch_queue` where `status='queued'` and dispatches via Resend / Postmark / SES, then sets `status='sent'` and `sent_at`. The "Send now" / "Send all queued" buttons currently flip status optimistically; wire them to a real provider for production.
- MFA / biometrics, REN videoconference flow, payment / subscription billing.
- PDF/A export of the register (CSV export ships now; PDF/A is next).

## Brand

NotariPro uses a cursive-N "Signature Flow" logo — a flowing handwritten N with a violet dot above and a swoosh underline. The wordmark is "Notari**Pro**" with Pro in italic violet. Color tokens live in the Tailwind config inside `index.html` and `app.html`:

- `navy-900` (#1a0f4f) — sidebar
- `violet-500/600` (#6f43c4 / #5a30a8) — primary actions, accents
- `violet-100` (#e3d8f7) — subtle backgrounds
- `ink-*` — neutrals

## Security notes

- The anon key is safe to ship to the browser — RLS is the only thing that protects user data, and it's enforced server-side. Never put the **service_role** key in the frontend.
- All five tables and the storage bucket have RLS policies in `sql/policies.sql`. If you add a new table, add policies before exposing it via the JS client.
- Audit logs use the user's own JWT for inserts (so RLS applies). For cron / system-driven mutations, use the service_role key from a Supabase Edge Function — it bypasses RLS but stays server-side.

## Troubleshooting

- **"Missing Supabase config" in console** → you didn't run the build step. Locally, copy `js/config.example.js` to `js/config.js` and fill in the keys.
- **"Email not confirmed"** → either click the confirmation email, or disable email confirmation under Authentication → Providers → Email.
- **`PGRST116` on first profile fetch** → trigger didn't fire. Re-run `sql/schema.sql` and confirm `on_auth_user_created` is listed under `auth.users` triggers.
- **403 on storage upload** → file path doesn't start with `<auth.uid()>/`. The upload helper already does this; check that the user is signed in before calling.
- **Empty register after creating entries** → confirm RLS policies in `policies.sql` were run after the schema.
