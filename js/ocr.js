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
      // Function deployed but ANTHROPIC_API_KEY not set, OR a model/auth error.
      if (data && data.configured === false) {
        console.info('[ocr-extract] not configured; using stub fallback.');
      } else {
        console.warn('[ocr-extract] non-ok response, using stub:', data);
        // Surface the real error on the returned object so app.js can toast it.
        const stub = await stubExtract(pdfFile);
        stub._ocrError = data?.error || 'Unknown OCR error';
        return stub;
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
  const dateOrEmpty = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  // jurat_date is the canonical "notarization_date" if not given separately
  const jurat = dateOrEmpty(raw.jurat_date) || dateOrEmpty(raw.notarization_date) || '';
  return {
    document_type: String(raw.document_type || '').trim(),
    notarial_act: String(raw.notarial_act || 'Jurat').trim(),
    summary: String(raw.summary || '').trim(),

    principal: String(raw.principal || '').trim(),
    principal_email: String(raw.principal_email || '').trim(),
    principal_address: String(raw.principal_address || '').trim(),
    principal_civil_status: String(raw.principal_civil_status || '').trim(),
    principal_profession: String(raw.principal_profession || '').trim(),
    ibp_roll_number: String(raw.ibp_roll_number || '').trim(),

    organization_name: String(raw.organization_name || '').trim(),
    organization_address: String(raw.organization_address || '').trim(),

    identity_reference: String(raw.identity_reference || '').trim(),

    venue_province: String(raw.venue_province || '').trim(),
    venue_city: String(raw.venue_city || '').trim(),
    execution_date: dateOrEmpty(raw.execution_date),
    execution_place: String(raw.execution_place || '').trim(),
    jurat_date: jurat,
    // notarization_date for legacy app code — defaults to jurat or today
    notarization_date: jurat || today,

    fee: Number(raw.fee) || 0,
    cc_emails: Array.isArray(raw.cc_emails) ? raw.cc_emails.filter(Boolean) : [],
    missing_fields: Array.isArray(raw.missing_fields)
      ? raw.missing_fields.filter(Boolean).map(String)
      : []
  };
}

async function stubExtract(pdfFile) {
  await new Promise(r => setTimeout(r, 1200));
  const name = (pdfFile?.name || '').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const baseStub = (overrides) => ({
    _stub: true,
    document_type: '', notarial_act: 'Jurat', summary: '',
    principal: '', principal_email: '', principal_address: '',
    principal_civil_status: '', principal_profession: '', ibp_roll_number: '',
    organization_name: '', organization_address: '',
    identity_reference: '',
    venue_province: '', venue_city: '',
    execution_date: '', execution_place: '', jurat_date: today, notarization_date: today,
    fee: 0, cc_emails: [], missing_fields: [],
    ...overrides
  });
  if (name.includes('deed') || name.includes('sale')) {
    return baseStub({ document_type: 'Deed of Absolute Sale', notarial_act: 'Acknowledgment',
      principal: 'Roberto C. Lim / Catherine D. Yu', principal_email: 'rlim@example.ph',
      cc_emails: ['cyu@example.ph'], fee: 1500.00 });
  }
  if (name.includes('spa') || name.includes('power') || name.includes('attorney')) {
    return baseStub({ document_type: 'Special Power of Attorney', notarial_act: 'Acknowledgment',
      principal: 'Eleanor M. Ramos', principal_email: 'e.ramos@example.ph', fee: 500.00 });
  }
  return baseStub({ document_type: 'Affidavit of Loss',
    principal: 'Maria S. dela Torre', principal_email: 'm.delatorre@example.ph', fee: 200.00 });
}
