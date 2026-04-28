// /js/ocr.js
// OCR PIPELINE — STUB
// ----------------------------------------------------------------------
// This is a placeholder. Replace the body of extractDocumentMetadata()
// with a real call to Claude Vision / a Supabase Edge Function /
// Google Document AI / etc. The interface below is what the rest of
// the app depends on, so keep the return shape stable.

/**
 * @typedef {Object} ExtractedMetadata
 * @property {string} document_type      e.g. "Affidavit of Loss"
 * @property {string} notarial_act       "Jurat" | "Acknowledgment" | ...
 * @property {string} principal          full name(s), separated by " / "
 * @property {string} principal_email
 * @property {string[]} cc_emails        additional emails detected on doc
 * @property {string} notarization_date  ISO YYYY-MM-DD
 * @property {number} fee
 */

/**
 * @param {File} pdfFile
 * @returns {Promise<ExtractedMetadata>}
 */
export async function extractDocumentMetadata(pdfFile) {
  // Simulated latency so the UI shows the scanning animation.
  await new Promise(r => setTimeout(r, 1500));

  const name = (pdfFile?.name || '').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);

  if (name.includes('deed') || name.includes('sale')) {
    return {
      document_type: 'Deed of Absolute Sale',
      notarial_act: 'Acknowledgment',
      principal: 'Roberto C. Lim / Catherine D. Yu',
      principal_email: 'rlim@example.ph',
      cc_emails: ['cyu@example.ph'],
      notarization_date: today,
      fee: 1500.00
    };
  }
  if (name.includes('spa') || name.includes('power') || name.includes('attorney')) {
    return {
      document_type: 'Special Power of Attorney',
      notarial_act: 'Acknowledgment',
      principal: 'Eleanor M. Ramos',
      principal_email: 'e.ramos@example.ph',
      cc_emails: [],
      notarization_date: today,
      fee: 500.00
    };
  }
  // default sample
  return {
    document_type: 'Affidavit of Loss',
    notarial_act: 'Jurat',
    principal: 'Maria S. dela Torre',
    principal_email: 'm.delatorre@example.ph',
    cc_emails: [],
    notarization_date: today,
    fee: 200.00
  };
}
