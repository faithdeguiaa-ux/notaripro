// /js/auth.js
// Supabase Auth wrapper + lawyer profile helpers.

import { supabase } from './supabaseClient.js';
import { logAudit } from './audit.js';

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await logAudit('login', { email });
  return data;
}

export async function signUp(email, password, fullName, dpaConsent = false) {
  if (!dpaConsent) {
    throw new Error('You must agree to the Privacy Notice and Terms of Service to create an account.');
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName || '' } }
  });
  if (error) throw error;
  // Profile row is created by the on_auth_user_created trigger.
  // Stamp the DPA consent + ToS acceptance timestamp now (best-effort: trigger
  // creates the row but we update the consent fields right after).
  if (data?.user) {
    const now = new Date().toISOString();
    try {
      await supabase.from('lawyers')
        .update({ dpa_consent_at: now, tos_accepted_at: now })
        .eq('id', data.user.id);
    } catch (e) {
      console.warn('[auth] consent stamp failed (non-fatal):', e?.message || e);
    }
  }
  await logAudit('signup', { email });
  return data;
}

export async function signOut() {
  await logAudit('logout');
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('lawyers')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) {
    // PGRST116 = no rows; fine on first login if trigger hasn't fired
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

export async function updateProfile(fields) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('lawyers')
    .update(fields)
    .eq('id', user.id)
    .select()
    .single();
  if (error) throw error;
  await logAudit('profile_update', { fields: Object.keys(fields) });
  return data;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}
