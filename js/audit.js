// /js/audit.js
// Append-only audit logger. Failures here MUST NOT break user flows.

import { supabase } from './supabaseClient.js';

/**
 * Log an audit event.
 * @param {string} action  One of: login, logout, signup, file_upload,
 *                         register_entry_created, email_queued, profile_update.
 * @param {object} metadata  Arbitrary JSON metadata.
 * @param {object} resource  Optional { type, id } pointer to the resource acted on.
 */
export async function logAudit(action, metadata = {}, resource = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action,
      resource_type: resource.type || null,
      resource_id: resource.id || null,
      metadata
    });
  } catch (e) {
    // Never throw from the audit pipeline.
    console.warn('[audit] log failed:', e?.message || e);
  }
}

export async function listAuditLogs({ limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
