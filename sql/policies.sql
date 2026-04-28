-- ============================================================
-- eNotaryo — Row Level Security Policies
-- Run AFTER schema.sql
-- ============================================================

-- Enable RLS on every table
alter table public.lawyers              enable row level security;
alter table public.documents            enable row level security;
alter table public.register_entries     enable row level security;
alter table public.email_dispatch_queue enable row level security;
alter table public.audit_logs           enable row level security;

-- ------------------------------------------------------------
-- lawyers: users see and edit their own profile only
-- ------------------------------------------------------------
drop policy if exists "lawyers_select_own" on public.lawyers;
create policy "lawyers_select_own" on public.lawyers
  for select using (auth.uid() = id);

drop policy if exists "lawyers_insert_own" on public.lawyers;
create policy "lawyers_insert_own" on public.lawyers
  for insert with check (auth.uid() = id);

drop policy if exists "lawyers_update_own" on public.lawyers;
create policy "lawyers_update_own" on public.lawyers
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ------------------------------------------------------------
-- documents: scoped to lawyer_id
-- ------------------------------------------------------------
drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own" on public.documents
  for select using (auth.uid() = lawyer_id);

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own" on public.documents
  for insert with check (auth.uid() = lawyer_id);

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own" on public.documents
  for delete using (auth.uid() = lawyer_id);

-- ------------------------------------------------------------
-- register_entries: scoped to lawyer_id
-- ------------------------------------------------------------
drop policy if exists "register_select_own" on public.register_entries;
create policy "register_select_own" on public.register_entries
  for select using (auth.uid() = lawyer_id);

drop policy if exists "register_insert_own" on public.register_entries;
create policy "register_insert_own" on public.register_entries
  for insert with check (auth.uid() = lawyer_id);

drop policy if exists "register_update_own" on public.register_entries;
create policy "register_update_own" on public.register_entries
  for update using (auth.uid() = lawyer_id) with check (auth.uid() = lawyer_id);

-- ------------------------------------------------------------
-- email_dispatch_queue: scoped to lawyer_id
-- ------------------------------------------------------------
drop policy if exists "emailq_select_own" on public.email_dispatch_queue;
create policy "emailq_select_own" on public.email_dispatch_queue
  for select using (auth.uid() = lawyer_id);

drop policy if exists "emailq_insert_own" on public.email_dispatch_queue;
create policy "emailq_insert_own" on public.email_dispatch_queue
  for insert with check (auth.uid() = lawyer_id);

drop policy if exists "emailq_update_own" on public.email_dispatch_queue;
create policy "emailq_update_own" on public.email_dispatch_queue
  for update using (auth.uid() = lawyer_id) with check (auth.uid() = lawyer_id);

-- ------------------------------------------------------------
-- audit_logs: users read their own; insert their own.
-- (Server-side jobs that mutate other users' data should use
--  service_role, which bypasses RLS.)
-- ------------------------------------------------------------
drop policy if exists "audit_select_own" on public.audit_logs;
create policy "audit_select_own" on public.audit_logs
  for select using (auth.uid() = user_id);

drop policy if exists "audit_insert_own" on public.audit_logs;
create policy "audit_insert_own" on public.audit_logs
  for insert with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Storage: each user's files live under <user_id>/...
-- ------------------------------------------------------------
drop policy if exists "storage_select_own" on storage.objects;
create policy "storage_select_own" on storage.objects
  for select using (
    bucket_id = 'notarial-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "storage_insert_own" on storage.objects;
create policy "storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'notarial-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "storage_update_own" on storage.objects;
create policy "storage_update_own" on storage.objects
  for update using (
    bucket_id = 'notarial-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "storage_delete_own" on storage.objects;
create policy "storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'notarial-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
