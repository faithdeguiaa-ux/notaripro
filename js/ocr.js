// /js/ocr.js
// OCR PIPELINE
// ----------------------------------------------------------------------
// Real OCR runs on the `ocr-extract` Supabase Edge Function (Claude Vision).
// If the function isn't configured (missing ANTHROPIC_API_KEY) or fails,
// we fall back to the filename-hint stub so the wizard remains usable.

import { supabase } from './supabaseClient.js';

/**
 * @typedef {Object} ExtractedMetadata
 * @property {string} document_type      e.g. "Affidavit of Loss"
 * @property {string} notarial_act       "Jurat" | "Acknowledgment" | ...
 * @property {string} principal          full name(s), separated by " / "
 * @property {string} principal_email
 * @property {string[]} cc_emails        additional emails detected on doc
 * @property {string} notarization_date  ISO YYYY-MM-DD
 * @property {number} fee
 * @property {string} [summary]
 * @property {boolean} [_stub]           true if returned from local fallback
 */

/**
 * @param {File} pdfFile
 * @param {string} [storagePath]   if provided, uses real OCR via Edge Function
 * @returns {Promise<ExtractedMetadata>}
 */
export async function extractDocumentMetadata(pdfFile, storagePath) {
  if (storagePath) {
    try {
      const { data, error } = await supabase.functions.invoke('ocr-extract', {
        body: { storage_path: storagePath }
      });
      if (error) {
        console.warn('[ocr-extract] invoke error, falling back to stub:', error.message);
        return await stubExtract(pdfFile);
      }
      if (data?.ok && data.extracted) {
        return normalize(data.extracted);
      }
      // Function deployed but ANTHROPIC_API_KEY not set, OR a model error.
      if (data && data.configured === false) {
        console.info('[ocr-extract] not configured; using stub fallback.');
      } else {
        console.warn('[ocr-extract] non-ok response, using stub:', data);
      }
      return await stubExtract(pdfFile);
    } catch (e) {
      console.warn('[ocr-extract] exception, using stub:', e?.message || e);
      return await stubExtract(pdfFile);
    }
  }
  // No storage path provided — use stub
  return await stubExtract(pdfFile);
}

function normalize(raw) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    document_type: String(raw.document_type || '').trim(),
    notarial_act: String(raw.notarial_act || 'Jurat').trim(),
    principal: String(raw.principal || '').trim(),
    principal_email: String(raw.principal_email || '').trim(),
    cc_emails: Array.isArray(raw.cc_emails) ? raw.cc_emails.filter(Boolean) : [],
    notarization_date: /^\d{4}-\d{2}-\d{2}$/.test(raw.notarization_date)
      ? raw.notarization_date : today,
    fee: Number(raw.fee) || 0,
    summary: raw.summary || ''
  };
}

async function stubExtract(pdfFile) {
  await new Promise(r => setTimeout(r, 1200));
  const name = (pdfFile?.name || '').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  if (name.includes('deed') || name.includes('sale')) {
    return { _stub: true, document_type: 'Deed of Absolute Sale', notarial_act: 'Acknowledgment',
      principal: 'Roberto C. Lim / Catherine D. Yu', principal_email: 'rlim@example.ph',
      cc_emails: ['cyu@example.ph'], notarization_date: today, fee: 1500.00 };
  }
  if (name.includes('spa') || name.includes('power') || name.includes('attorney')) {
    return { _stub: true, document_type: 'Special Power of Attorney', notarial_act: 'Acknowledgment',
      principal: 'Eleanor M. Ramos', principal_email: 'e.ramos@example.ph',
      cc_emails: [], notarization_date: today, fee: 500.00 };
  }
  return { _stub: true, document_type: 'Affidavit of Loss', notarial_act: 'Jurat',
    principal: 'Maria S. dela Torre', principal_email: 'm.delatorre@example.ph',
    cc_emails: [], notarization_date: today, fee: 200.00 };
}
