// /js/emailQueue.js
// Persists outbound emails into email_dispatch_queue.
// External email delivery is intentionally NOT implemented yet —
// a future Supabase Edge Function or cron job will consume this queue.

import { supabase } from './supabaseClient.js';
import { logAudit } from './audit.js';

/**
 * Enqueue a single outbound email.
 * @param {object} input
 * @param {string} input.recipient
 * @param {string} [input.cc]
 * @param {string} input.subject
 * @param {string} input.body
 * @param {string} [input.attachment_path]   storage path inside notarial-documents
 * @param {string} [input.register_entry_id] FK
 * @param {Date|string} [input.scheduled_send_time] ISO timestamp; null = ASAP
 */
export async function queueEmail(input) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const row = {
    lawyer_id: user.id,
    register_entry_id: input.register_entry_id || null,
    recipient: input.recipient,
    cc: input.cc || null,
    subject: input.subject,
    body: input.body,
    attachment_path: input.attachment_path || null,
    scheduled_send_time: input.scheduled_send_time || null,
    status: 'queued'
  };

  const { data, error } = await supabase
    .from('email_dispatch_queue')
    .insert(row)
    .select()
    .single();
  if (error) throw error;

  await logAudit(
    'email_queued',
    { recipient: input.recipient, register_entry_id: input.register_entry_id || null },
    { type: 'email', id: data.id }
  );
  return data;
}

/**
 * Enqueue many emails atomically (best-effort: parallel inserts).
 */
export async function queueEmails(items) {
  return Promise.all(items.map(queueEmail));
}

export async function listQueue() {
  const { data, error } = await supabase
    .from('email_dispatch_queue')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function countQueued() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count, error } = await supabase
    .from('email_dispatch_queue')
    .select('*', { count: 'exact', head: true })
    .eq('lawyer_id', user.id)
    .eq('status', 'queued');
  if (error) return 0;
  return count || 0;
}
