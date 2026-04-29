-- ============================================================
-- eNotaryo — Database Schema
-- Run this in Supabase SQL Editor (SQL > New query)
-- ============================================================

-- Required extensions
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. lawyers (profile, 1:1 with auth.users)
-- ------------------------------------------------------------
create table if not exists public.lawyers (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  roll_number text,
  ibp_number text,
  ptr_number text,
  mcle_number text,
  jurisdiction text,
  commission_expiry date,
  -- register state
  current_book_no text not null default 'I',
  current_page_no integer not null default 1,
  current_doc_no integer not null default 0,
  series_year integer not null default extract(year from now())::int,
  -- dispatch defaults
  ocs_email text,
  archive_email text,
  filename_pattern text not null default '{date}_{type}_{principal}_Doc-{doc_no}_Page-{page}_Book{book}_{year}.pdf',
  daily_dispatch_time time default '17:00',
  -- meta
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. documents (uploaded PDFs metadata)
-- ------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  lawyer_id uuid not null references public.lawyers(id) on delete cascade,
  storage_path text not null,
  original_filename text,
  size_bytes bigint,
  mime_type text default 'application/pdf',
  uploaded_at timestamptz not null default now()
);
create index if not exists documents_lawyer_idx on public.documents(lawyer_id, uploaded_at desc);

-- ------------------------------------------------------------
-- 3. register_entries (the Digital Notarial Register)
-- ------------------------------------------------------------
create table if not exists public.register_entries (
  id uuid primary key default gen_random_uuid(),
  lawyer_id uuid not null references public.lawyers(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  doc_no integer not null,
  page_no integer not null,
  book_no text not null,
  series_year integer not null,
  document_type text not null,
  notarial_act text,
  principal text not null,
  principal_email text,
  notarization_date date not null,
  fee numeric(10,2) not null default 0,
  filename text not null,
  status text not null default 'logged',  -- logged | dispatched | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lawyer_id, doc_no, book_no, series_year)
);
create index if not exists register_entries_lawyer_date_idx on public.register_entries(lawyer_id, notarization_date desc);
create index if not exists register_entries_lawyer_book_idx on public.register_entries(lawyer_id, book_no, series_year);
create index if not exists register_entries_lawyer_created_idx on public.register_entries(lawyer_id, created_at desc);

-- ------------------------------------------------------------
-- 4. email_dispatch_queue
-- ------------------------------------------------------------
create table if not exists public.email_dispatch_queue (
  id uuid primary key default gen_random_uuid(),
  lawyer_id uuid not null references public.lawyers(id) on delete cascade,
  register_entry_id uuid references public.register_entries(id) on delete cascade,
  recipient text not null,
  cc text,
  subject text not null,
  body text not null,
  attachment_path text,
  status text not null default 'queued',  -- queued | sent | failed
  scheduled_send_time timestamptz,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists email_queue_status_idx on public.email_dispatch_queue(status, scheduled_send_time);
create index if not exists email_queue_lawyer_idx on public.email_dispatch_queue(lawyer_id, created_at desc);

-- ------------------------------------------------------------
-- 5. audit_logs
-- ------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_user_idx on public.audit_logs(user_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs(action, created_at desc);

-- ------------------------------------------------------------
-- updated_at touch trigger
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_lawyers_updated on public.lawyers;
create trigger trg_lawyers_updated before update on public.lawyers
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_register_updated on public.register_entries;
create trigger trg_register_updated before update on public.register_entries
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Auto-create lawyer profile on signup
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lawyers (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Storage bucket
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('notarial-documents', 'notarial-documents', false)
on conflict (id) do nothing;

-- ============================================================
-- v2: compliance — document integrity, monthly reports, dispatch tracking
-- (Idempotent: safe to re-run.)
-- ============================================================

-- 1. Document SHA-256 fingerprint (computed client-side at upload time)
alter table public.documents
  add column if not exists sha256 text;
create index if not exists documents_lawyer_uploaded_idx
  on public.documents(lawyer_id, uploaded_at desc);

-- 2. Notarial reports (track when monthly/period reports were generated)
create table if not exists public.notarial_reports (
  id uuid primary key default gen_random_uuid(),
  lawyer_id uuid not null references public.lawyers(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  entry_count integer not null default 0,
  storage_path text,
  generated_at timestamptz not null default now(),
  unique (lawyer_id, period_start, period_end)
);
create index if not exists notarial_reports_lawyer_idx
  on public.notarial_reports(lawyer_id, generated_at desc);

alter table public.notarial_reports enable row level security;
drop policy if exists "reports_select_own" on public.notarial_reports;
create policy "reports_select_own" on public.notarial_reports
  for select using (auth.uid() = lawyer_id);
drop policy if exists "reports_insert_own" on public.notarial_reports;
create policy "reports_insert_own" on public.notarial_reports
  for insert with check (auth.uid() = lawyer_id);

-- 3. Email dispatch tracking — provider message id, attempts
alter table public.email_dispatch_queue
  add column if not exists provider_message_id text,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

-- 4. Convenience view for monthly summaries
create or replace view public.v_register_monthly as
select
  lawyer_id,
  date_trunc('month', notarization_date)::date as month_start,
  count(*) as entry_count,
  sum(fee) as fees_total
from public.register_entries
group by lawyer_id, date_trunc('month', notarization_date)::date;

-- ============================================================
-- v3: register-grade extracted metadata (Claude Vision OCR fields)
-- ============================================================

alter table public.register_entries
  add column if not exists venue_province text,
  add column if not exists venue_city text,
  add column if not exists execution_date date,
  add column if not exists execution_place text,
  add column if not exists jurat_date date,
  add column if not exists principal_address text,
  add column if not exists principal_civil_status text,
  add column if not exists principal_profession text,
  add column if not exists organization_name text,
  add column if not exists organization_address text,
  add column if not exists identity_reference text,
  add column if not exists ibp_roll_number text,
  add column if not exists summary text,
  add column if not exists missing_fields text[];

create index if not exists register_entries_org_idx
  on public.register_entries(lawyer_id, organization_name);
