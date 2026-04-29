// /js/storage.js
// Upload PDFs to the 'notarial-documents' bucket and persist
// a documents row. Files live under <user_id>/<timestamp>_<safe_name>.pdf,
// which is what the storage RLS policy in policies.sql expects.
//
// On upload we also compute a SHA-256 of the file bytes (client-side)
// and persist it to documents.sha256 — that gives the lawyer a tamper-
// evident fingerprint they can re-check anytime.

import { supabase } from './supabaseClient.js';
import { logAudit } from './audit.js';

const BUCKET = 'notarial-documents';

export async function uploadPdf(file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (!file) throw new Error('No file provided');

  // Hash the file bytes BEFORE upload so we capture the exact thing we sent.
  const sha256 = await sha256Hex(file);

  const path = `${user.id}/${Date.now()}_${sanitize(file.name)}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/pdf',
    upsert: false
  });
  if (upErr) throw upErr;

  const { data: doc, error: docErr } = await supabase.from('documents').insert({
    lawyer_id: user.id,
    storage_path: path,
    original_filename: file.name,
    size_bytes: file.size,
    mime_type: file.type || 'application/pdf',
    sha256
  }).select().single();
  if (docErr) throw docErr;

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24);

  await logAudit(
    'file_upload',
    { path, size: file.size, original_filename: file.name, sha256 },
    { type: 'document', id: doc.id }
  );

  return { document: doc, signedUrl: signed?.signedUrl, path };
}

/**
 * Compute SHA-256 of a Blob/File and return as a 64-char hex string.
 * Uses Web Crypto, which is available in all evergreen browsers.
 */
export async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function getSignedUrl(path, ttlSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteFile(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

function sanitize(name) {
  return (name || 'document.pdf').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
}
