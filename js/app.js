// /js/app.js
// Wires the existing eNotaryo UI to Supabase. Keeps the original DOM
// structure unchanged — only swaps the inline mock-data logic.

import {
  signIn, signUp, signOut, onAuthStateChange,
  getCurrentUser, getCurrentProfile, updateProfile
} from './auth.js';
import { uploadPdf, getSignedUrl } from './storage.js';
import { listEntries, createEntry, getEntryStats } from './register.js';
import { queueEmails, listQueue, countQueued } from './emailQueue.js';
import { extractDocumentMetadata } from './ocr.js';
import { logAudit } from './audit.js';

// ----------------- App-level state -----------------
const state = {
  profile: null,           // lawyers row
  wizard: {
    file: null,
    document: null,        // documents row from upload
    extracted: null,       // ExtractedMetadata
    createdEntry: null,    // register_entries row (after step 3)
    signedUrl: null
  }
};

// =============================================================
// 1. AUTH BOOTSTRAP
// =============================================================
window.addEventListener('DOMContentLoaded', async () => {
  bindStaticHandlers();

  const user = await getCurrentUser();
  if (user) {
    await afterLogin();
  } else {
    showScreen('login');
  }

  onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showScreen('login');
  });
});

function bindStaticHandlers() {
  // Login form
  const loginBtn = document.getElementById('btn-login');
  if (loginBtn) loginBtn.addEventListener('click', handleLogin);

  const signupToggle = document.getElementById('btn-show-signup');
  if (signupToggle) signupToggle.addEventListener('click', () => toggleAuthMode('signup'));

  const loginToggle = document.getElementById('btn-show-login');
  if (loginToggle) loginToggle.addEventListener('click', () => toggleAuthMode('login'));

  const signupBtn = document.getElementById('btn-signup');
  if (signupBtn) signupBtn.addEventListener('click', handleSignup);

  // Sidebar nav
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Sign out
  const signoutBtn = document.getElementById('btn-signout');
  if (signoutBtn) signoutBtn.addEventListener('click', handleSignout);

  // File input + samples
  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.addEventListener('change', onFileSelected);

  document.querySelectorAll('[data-sample]').forEach(btn => {
    btn.addEventListener('click', () => onSampleClicked(btn.dataset.sample));
  });

  // Wizard buttons
  document.querySelectorAll('[data-wiz-back]').forEach(btn => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.wizBack)));
  });
  document.querySelectorAll('[data-wiz-next]').forEach(btn => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.wizNext)));
  });

  const commitBtn = document.getElementById('btn-commit-register');
  if (commitBtn) commitBtn.addEventListener('click', handleCommitRegister);

  const sendNowBtn = document.getElementById('btn-send-now');
  if (sendNowBtn) sendNowBtn.addEventListener('click', () => handleDispatch('send'));

  const queueBtn = document.getElementById('btn-queue-batch');
  if (queueBtn) queueBtn.addEventListener('click', () => handleDispatch('queue'));

  const newAnotherBtn = document.getElementById('btn-new-another');
  if (newAnotherBtn) newAnotherBtn.addEventListener('click', () => { resetWizard(); setView('new'); });

  // Register filters
  ['reg-search', 'reg-filter-type', 'reg-filter-month'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => renderRegister());
  });

  const exportBtn = document.getElementById('btn-export-register');
  if (exportBtn) exportBtn.addEventListener('click', () => toast('PDF/A export coming soon — entries are persisted in your Supabase project.'));

  // Settings
  const saveSettingsBtn = document.getElementById('btn-save-settings');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', handleSaveSettings);
}

// =============================================================
// 2. AUTH HANDLERS
// =============================================================
function toggleAuthMode(mode) {
  document.getElementById('auth-login').classList.toggle('hidden', mode !== 'login');
  document.getElementById('auth-signup').classList.toggle('hidden', mode !== 'signup');
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    await signIn(email, password);
    await afterLogin();
  } catch (e) {
    errEl.textContent = e.message || 'Sign-in failed.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

async function handleSignup() {
  const fullName = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl = document.getElementById('signup-error');
  errEl.textContent = '';
  const btn = document.getElementById('btn-signup');
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const { user, session } = await signUp(email, password, fullName);
    if (session) {
      await afterLogin();
    } else {
      errEl.textContent = 'Check your email to confirm your account, then sign in.';
      toggleAuthMode('login');
    }
  } catch (e) {
    errEl.textContent = e.message || 'Sign-up failed.';
  } finally {
    btn.disabled = false; btn.textContent = 'Create account';
  }
}

async function handleSignout() {
  await signOut();
  showScreen('login');
}

async function afterLogin() {
  showScreen('app');
  state.profile = await getCurrentProfile();
  renderProfileChrome();
  setView('dashboard');
}

// =============================================================
// 3. NAVIGATION + PROFILE CHROME
// =============================================================
function showScreen(s) {
  document.getElementById('screen-login').classList.toggle('hidden', s !== 'login');
  document.getElementById('screen-app').classList.toggle('hidden', s !== 'app');
}

function setView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById('view-' + view);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const btn = document.querySelector(`[data-view="${view}"]`);
  if (btn) btn.classList.add('active');

  if (view === 'dashboard') renderDashboard();
  if (view === 'register') renderRegister();
  if (view === 'outbox') renderOutbox();
  if (view === 'new') resetWizard();
  if (view === 'settings') renderSettings();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderProfileChrome() {
  const p = state.profile || {};
  const initials = (p.full_name || p.email || '?').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
  setText('profile-initials', initials);
  setText('profile-name', p.full_name || p.email || '');
  const meta = [p.roll_number ? `Roll No. ${p.roll_number}` : null, p.jurisdiction].filter(Boolean).join(' · ');
  setText('profile-meta', meta || '—');
}

// =============================================================
// 4. DASHBOARD
// =============================================================
async function renderDashboard() {
  setText('today-date', new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  }));

  const greetingName = (state.profile?.full_name || '').split(' ')[0] || 'Counsel';
  setText('greeting', `Good day, Atty. ${greetingName}.`);

  try {
    const stats = await getEntryStats();
    setText('kpi-today', stats?.today ?? 0);
    setText('kpi-month', stats?.month ?? 0);
    setText('kpi-pending', stats?.pendingDispatch ?? 0);

    const recent = await listEntries();
    const top5 = recent.slice(0, 5);
    const ra = document.getElementById('recent-activity');
    if (ra) {
      if (top5.length === 0) {
        ra.innerHTML = `<div class="px-5 py-8 text-center text-sm text-ink-500">
          No notarizations yet. Click <strong>New Notarization</strong> to log your first entry.
        </div>`;
      } else {
        ra.innerHTML = top5.map(r => `
          <div class="px-5 py-3 flex items-center gap-4 hover:bg-ink-50 transition">
            <div class="w-9 h-9 rounded-lg bg-gold-50 text-gold-700 flex items-center justify-center font-mono text-xs">${pad3(r.doc_no)}</div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">${escapeHtml(r.document_type)}</div>
              <div class="text-xs text-ink-500 truncate">${escapeHtml(r.principal)} · ₱${Number(r.fee).toFixed(2)}</div>
            </div>
            <div class="text-xs text-ink-500">${r.notarization_date}</div>
            ${pillForStatus(r.status)}
          </div>
        `).join('');
      }
    }

    updateOutboxBadge(stats?.pendingDispatch || 0);
  } catch (e) {
    console.error(e);
    toast('Could not load dashboard. Check Supabase connection.');
  }
}

function pillForStatus(status) {
  if (status === 'dispatched') return '<span class="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full font-medium">Sent</span>';
  if (status === 'queued')     return '<span class="text-[10px] bg-gold-100 text-gold-700 px-2 py-1 rounded-full font-medium">Queued</span>';
  return '<span class="text-[10px] bg-ink-100 text-ink-700 px-2 py-1 rounded-full font-medium">Logged</span>';
}

// =============================================================
// 5. NEW NOTARIZATION WIZARD
// =============================================================
function resetWizard() {
  state.wizard = { file: null, document: null, extracted: null, createdEntry: null, signedUrl: null };
  [1, 2, 3, 4, 5].forEach(n => document.getElementById('wiz-step-' + n)?.classList.add('hidden'));
  document.getElementById('wiz-step-1')?.classList.remove('hidden');
  setStepperState(1);
  const fi = document.getElementById('file-input');
  if (fi) fi.value = '';
}

function setStepperState(active) {
  [1, 2, 3, 4].forEach(n => {
    const dot = document.getElementById('step-dot-' + n);
    const line = document.getElementById('step-line-' + n);
    if (!dot) return;
    dot.classList.remove('active', 'done');
    if (line) line.classList.remove('done');
    if (n < active) { dot.classList.add('done'); dot.innerHTML = '✓'; if (line) line.classList.add('done'); }
    else if (n === active) { dot.classList.add('active'); dot.innerHTML = n; }
    else { dot.innerHTML = n; }
  });
}

async function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.type && file.type !== 'application/pdf') {
    toast('Only PDF or PDF/A files are accepted.');
    return;
  }
  await runUploadAndExtract(file);
}

async function onSampleClicked(idx) {
  // Build a tiny pseudo-PDF blob locally so we have a real file to upload.
  const fakeName = ['affidavit_of_loss.pdf', 'deed_of_sale.pdf', 'spa.pdf'][idx] || 'sample.pdf';
  const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D])], { type: 'application/pdf' });
  const file = new File([blob], fakeName, { type: 'application/pdf' });
  await runUploadAndExtract(file);
}

async function runUploadAndExtract(file) {
  // Switch to step 2 immediately to show scanning UI
  document.getElementById('wiz-step-1').classList.add('hidden');
  document.getElementById('wiz-step-2').classList.remove('hidden');
  setStepperState(2);
  document.getElementById('pdf-scanning').classList.remove('hidden');
  document.getElementById('pdf-rendered').classList.add('hidden');

  state.wizard.file = file;

  try {
    // Upload + OCR in parallel. Avoid naming a local `document` here —
    // it would shadow the global DOM document object.
    const [uploadResult, extracted] = await Promise.all([
      uploadPdf(file),
      extractDocumentMetadata(file)
    ]);
    state.wizard.document = uploadResult.document;
    state.wizard.signedUrl = uploadResult.signedUrl;
    state.wizard.extracted = extracted;
    populateExtractedFields(extracted);
    document.getElementById('pdf-scanning').classList.add('hidden');
    document.getElementById('pdf-rendered').classList.remove('hidden');
    paintPreview(extracted);
  } catch (e) {
    console.error(e);
    toast('Upload or extraction failed: ' + (e.message || e));
    resetWizard();
  }
}

function populateExtractedFields(ex) {
  setVal('ext-type', ex.document_type);
  setVal('ext-act', ex.notarial_act);
  setVal('ext-date', ex.notarization_date);
  setVal('ext-fee', ex.fee.toFixed(2));

  const pBox = document.getElementById('ext-principals');
  if (pBox) {
    const principals = ex.principal.split('/').map(p => p.trim()).filter(Boolean);
    pBox.innerHTML = principals.map((name, i) => `
      <div class="bg-ink-50 rounded-lg p-3 border border-ink-100">
        <div class="grid grid-cols-2 gap-2">
          <input class="px-3 py-1.5 bg-white border border-ink-200 rounded-lg text-sm" value="${escapeAttr(name)}">
          <input class="px-3 py-1.5 bg-white border border-ink-200 rounded-lg text-sm" value="${escapeAttr(i === 0 ? ex.principal_email : (ex.cc_emails[i-1] || ''))}">
        </div>
      </div>
    `).join('');
  }

  const eBox = document.getElementById('ext-emails');
  if (eBox) {
    const emails = [ex.principal_email, ...(ex.cc_emails || []), state.profile?.ocs_email].filter(Boolean);
    eBox.innerHTML = emails.map(e => `<span class="text-xs bg-ink-100 text-ink-700 px-2 py-1 rounded-full">${escapeHtml(e)}</span>`).join('');
  }
}

function paintPreview(ex) {
  setText('prev-title', (ex.document_type || '').toUpperCase());
  setText('prev-name', (ex.principal || '').toUpperCase());
  setText('prev-email', ex.principal_email || '');
  setText('prev-date', formatLong(ex.notarization_date));
}

async function handleCommitRegister() {
  const ex = state.wizard.extracted;
  if (!ex) return;
  // Read possibly-edited fields
  ex.document_type = readVal('ext-type', ex.document_type);
  ex.notarial_act = readVal('ext-act', ex.notarial_act);
  ex.notarization_date = readVal('ext-date', ex.notarization_date);
  ex.fee = Number(readVal('ext-fee', ex.fee));

  try {
    const created = await createEntry({
      document_type: ex.document_type,
      notarial_act: ex.notarial_act,
      principal: ex.principal,
      principal_email: ex.principal_email,
      notarization_date: ex.notarization_date,
      fee: ex.fee,
      document_id: state.wizard.document?.id || null
    });
    state.wizard.createdEntry = created;
    paintRegisterPreview(created);
    paintDispatchEmails(created, ex);
    goToStep(4);
    toast(`Logged · Doc. No. ${pad3(created.doc_no)}`);
  } catch (e) {
    console.error(e);
    toast('Register insert failed: ' + (e.message || e));
  }
}

function paintRegisterPreview(entry) {
  setText('reg-doc', pad3(entry.doc_no));
  setText('reg-page', entry.page_no);
  setText('reg-book', entry.book_no);
  setText('reg-series', entry.series_year);
  setText('reg-date', entry.notarization_date);
  setText('reg-principal', entry.principal);
  setText('reg-type', entry.document_type);
  setText('reg-fee-display', '₱' + Number(entry.fee).toFixed(2));
  setText('filename-preview', entry.filename);
}

function paintDispatchEmails(entry, ex) {
  const docNo = pad3(entry.doc_no);
  const principals = entry.principal.split('/').map(p => p.trim()).filter(Boolean);
  const recipientEmails = [ex.principal_email, ...(ex.cc_emails || [])].filter(Boolean);

  const emails = principals.map((name, i) => ({
    to: recipientEmails[i] || ex.principal_email,
    who: name,
    subject: `Notarized: ${entry.document_type} (Doc No. ${docNo}, Book ${entry.book_no})`,
    body: `Dear ${name.split(' ')[0]},\n\nThank you for your visit today. Please find attached the duly notarized ${entry.document_type}.\n\nRegister entry: Doc. No. ${docNo}, Page No. ${entry.page_no}, Book No. ${entry.book_no}, Series of ${entry.series_year}.\n\nA courtesy copy has been CC'd to the Office of the Clerk of Court — ${state.profile?.jurisdiction || '[OCS]'}, in compliance with the 2004 Notarial Rules.\n\nVery truly yours,\n${state.profile?.full_name || 'Atty. ___'}\nNotary Public${state.profile?.roll_number ? ' · Roll No. ' + state.profile.roll_number : ''}`
  }));

  if (state.profile?.ocs_email) {
    emails.push({
      to: state.profile.ocs_email,
      who: 'Office of the Clerk of Court',
      subject: `Notarial Submission: ${entry.document_type} (Doc No. ${docNo}, Book ${entry.book_no})`,
      body: `To the Honorable Clerk of Court,\n\nGreetings. In compliance with my reportorial obligations as a notary public, I respectfully transmit the attached notarized document for your records:\n\nDocument: ${entry.document_type}\nPrincipal(s): ${entry.principal}\nDoc. No.: ${docNo}\nPage No.: ${entry.page_no}\nBook No.: ${entry.book_no}\nSeries of: ${entry.series_year}\nDate Notarized: ${entry.notarization_date}\n\nVery respectfully,\n${state.profile?.full_name || 'Atty. ___'}\nNotary Public${state.profile?.roll_number ? ' · Roll No. ' + state.profile.roll_number : ''}`
    });
  }

  state.wizard.dispatchPlan = emails;

  const wrap = document.getElementById('dispatch-emails');
  if (!wrap) return;
  wrap.innerHTML = emails.map((e, i) => `
    <details class="border border-ink-100 rounded-lg" ${i === 0 ? 'open' : ''}>
      <summary class="p-4 flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-ink-100 flex items-center justify-center text-xs font-medium text-ink-700">${initialsOf(e.who)}</div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${escapeHtml(e.subject)}</div>
          <div class="text-xs text-ink-500 truncate">To: ${escapeHtml(e.to)}</div>
        </div>
        <span class="text-xs bg-gold-100 text-gold-700 px-2 py-1 rounded-full font-medium">Auto-drafted</span>
      </summary>
      <div class="px-4 pb-4 border-t border-ink-100 pt-3 text-sm">
        <textarea data-email-body="${i}" class="w-full p-3 border border-ink-200 rounded-lg text-sm font-sans" rows="9">${escapeHtml(e.body)}</textarea>
        <div class="flex items-center gap-2 mt-2 text-xs text-ink-500">Attached: <code>${escapeHtml(entry.filename)}</code></div>
      </div>
    </details>
  `).join('');
}

async function handleDispatch(mode) {
  const entry = state.wizard.createdEntry;
  const plan = state.wizard.dispatchPlan;
  if (!entry || !plan) return;

  // pick up edited bodies
  document.querySelectorAll('[data-email-body]').forEach(t => {
    const i = Number(t.dataset.emailBody);
    if (plan[i]) plan[i].body = t.value;
  });

  const scheduled = mode === 'queue' ? batchTimeToday(state.profile?.daily_dispatch_time || '17:00') : null;

  try {
    await queueEmails(plan.map(p => ({
      recipient: p.to,
      subject: p.subject,
      body: p.body,
      attachment_path: state.wizard.document?.storage_path || null,
      register_entry_id: entry.id,
      scheduled_send_time: scheduled
    })));

    setText('done-doc-no',
      `Doc. No. ${pad3(entry.doc_no)}, Page ${entry.page_no}, Book ${entry.book_no}, Series of ${entry.series_year}.`);
    setText('done-summary', mode === 'send'
      ? `${plan.length} email(s) queued for immediate dispatch.`
      : `${plan.length} email(s) queued for batch dispatch at ${state.profile?.daily_dispatch_time || '17:00'} today.`);
    goToStep(5);
    updateOutboxBadge(await countQueued());
    toast(mode === 'send' ? 'Dispatch queued for send.' : 'Queued for batch dispatch.');
  } catch (e) {
    console.error(e);
    toast('Email queue insert failed: ' + (e.message || e));
  }
}

function goToStep(n) {
  [1, 2, 3, 4, 5].forEach(i => document.getElementById('wiz-step-' + i)?.classList.add('hidden'));
  document.getElementById('wiz-step-' + n)?.classList.remove('hidden');
  setStepperState(n);
}

// =============================================================
// 6. REGISTER VIEW
// =============================================================
async function renderRegister() {
  const search = document.getElementById('reg-search')?.value || '';
  const type = document.getElementById('reg-filter-type')?.value || '';
  const month = document.getElementById('reg-filter-month')?.value || '';
  const tbody = document.getElementById('register-tbody');
  if (!tbody) return;
  try {
    const rows = await listEntries({ search, type, month });
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-ink-500 text-sm">No entries match.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr class="hover:bg-ink-50">
        <td class="px-4 py-3 font-mono text-xs">${pad3(r.doc_no)}</td>
        <td class="px-4 py-3 text-ink-600">${r.notarization_date}</td>
        <td class="px-4 py-3">${escapeHtml(r.document_type)}</td>
        <td class="px-4 py-3 text-ink-700">${escapeHtml(r.principal)}</td>
        <td class="px-4 py-3 text-ink-500">${r.page_no}</td>
        <td class="px-4 py-3 text-right font-medium">₱${Number(r.fee).toFixed(2)}</td>
        <td class="px-4 py-3">${pillForStatus(r.status)}</td>
        <td class="px-4 py-3 text-right"><span class="text-xs text-ink-400">${escapeHtml(r.book_no)} · ${r.series_year}</span></td>
      </tr>
    `).join('');
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-rose-600 text-sm">Failed to load: ${escapeHtml(e.message || '')}</td></tr>`;
  }
}

// =============================================================
// 7. OUTBOX
// =============================================================
async function renderOutbox() {
  const wrap = document.getElementById('outbox-list');
  if (!wrap) return;
  try {
    const rows = await listQueue();
    if (rows.length === 0) {
      wrap.innerHTML = `<div class="bg-white border border-ink-100 rounded-xl p-8 text-center text-sm text-ink-500">No outbound emails yet.</div>`;
      return;
    }
    wrap.innerHTML = rows.map(e => `
      <div class="bg-white border border-ink-100 rounded-xl p-5">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-lg bg-${e.status==='sent'?'emerald':'gold'}-100 text-${e.status==='sent'?'emerald':'gold'}-700 flex items-center justify-center text-xs font-semibold uppercase">${e.status[0]}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
              <div class="text-sm font-medium truncate">${escapeHtml(e.subject)}</div>
              <span class="text-[10px] bg-${e.status==='sent'?'emerald':'gold'}-50 text-${e.status==='sent'?'emerald':'gold'}-700 px-2 py-0.5 rounded-full font-medium uppercase tracking-wider">${e.status}</span>
            </div>
            <div class="text-xs text-ink-500 mt-0.5">To: ${escapeHtml(e.recipient)}${e.cc ? ' · CC: ' + escapeHtml(e.cc) : ''}</div>
            <div class="text-xs text-ink-400 mt-0.5">${new Date(e.created_at).toLocaleString()}${e.scheduled_send_time ? ' · scheduled ' + new Date(e.scheduled_send_time).toLocaleString() : ''}</div>
            <details class="mt-3"><summary class="text-xs text-ink-600 hover:text-ink-900 cursor-pointer">View body</summary><pre class="text-xs text-ink-700 mt-2 bg-ink-50 p-3 rounded-lg whitespace-pre-wrap font-sans">${escapeHtml(e.body)}</pre></details>
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    wrap.innerHTML = `<div class="text-rose-600">Failed to load outbox: ${escapeHtml(e.message || '')}</div>`;
  }
}

function updateOutboxBadge(n) {
  const badge = document.getElementById('outbox-badge');
  if (!badge) return;
  if (n > 0) { badge.textContent = n; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

// =============================================================
// 8. SETTINGS
// =============================================================
function renderSettings() {
  const p = state.profile || {};
  setVal('s-full-name', p.full_name);
  setVal('s-roll', p.roll_number);
  setVal('s-ibp', p.ibp_number);
  setVal('s-ptr', p.ptr_number);
  setVal('s-mcle', p.mcle_number);
  setVal('s-expiry', p.commission_expiry);
  setVal('s-jurisdiction', p.jurisdiction);
  setVal('s-ocs', p.ocs_email);
  setVal('s-archive', p.archive_email);
  setVal('s-pattern', p.filename_pattern);
}

async function handleSaveSettings() {
  const fields = {
    full_name: readVal('s-full-name', ''),
    roll_number: readVal('s-roll', ''),
    ibp_number: readVal('s-ibp', ''),
    ptr_number: readVal('s-ptr', ''),
    mcle_number: readVal('s-mcle', ''),
    commission_expiry: readVal('s-expiry', '') || null,
    jurisdiction: readVal('s-jurisdiction', ''),
    ocs_email: readVal('s-ocs', ''),
    archive_email: readVal('s-archive', ''),
    filename_pattern: readVal('s-pattern', '')
  };
  try {
    state.profile = await updateProfile(fields);
    renderProfileChrome();
    toast('Settings saved.');
  } catch (e) {
    toast('Save failed: ' + (e.message || e));
  }
}

// =============================================================
// helpers
// =============================================================
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v ?? ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function readVal(id, fallback) { const el = document.getElementById(id); return el ? el.value : fallback; }
function pad3(n) { return String(n).padStart(3, '0'); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function initialsOf(s) { return (s || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
function formatLong(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}
function batchTimeToday(hhmm) {
  const [h, m] = (hhmm || '17:00').split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return d.toISOString();
}
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
