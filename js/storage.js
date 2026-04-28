// /js/storage.js
// Upload PDFs to the 'notarial-documents' bucket and persist
// a documents row. Files live under <user_id>/<timestamp>_<safe_name>.pdf,
// which is what the storage RLS policy in policies.sql expects.

import { supabase } from './supabaseClient.js';
import { logAudit } from './audit.js';

const BUCKET = 'notarial-documents';

/**
 * Upload a PDF and return { document, signedUrl, path }.
 * @param {File} file
 */
export async function uploadPdf(file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (!file) throw new Error('No file provided');

  const path = `${user.id}/${Date.now()}_${sanitize(file.name)}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/pdf',
    upsert: false
  });
  if (upErr) throw upErr;

  // Persist documents row
  const { data: doc, error: docErr } = await supabase.from('documents').insert({
    lawyer_id: user.id,
    storage_path: path,
    original_filename: file.name,
    size_bytes: file.size,
    mime_type: file.type || 'application/pdf'
  }).select().single();
  if (docErr) throw docErr;

  // Signed URL valid for 24h (bucket is private)
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24);

  await logAudit(
    'file_upload',
    { path, size: file.size, original_filename: file.name },
    { type: 'document', id: doc.id }
  );

  return { document: doc, signedUrl: signed?.signedUrl, path };
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
