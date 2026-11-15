create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense','ar','ap')),
  category text not null default '',
  vendor_or_customer text not null default '',
  amount numeric not null check (amount > 0),
  currency text not null default 'USD',
  transaction_date date not null,
  due_date date,
  status text not null default 'paid' check (status in ('paid','pending','overdue')),
  source text not null default 'manual' check (source in ('manual','ocr')),
  document_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_url text,
  doc_type text not null check (doc_type in ('receipt','invoice','bank_statement')),
  ocr_raw_json jsonb,
  reviewed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists risk_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  low_cash_threshold_months numeric not null default 3,
  warning_email text not null default '',
  ar_overdue_spike_pct numeric not null default 25,
  enabled boolean not null default true
);

create table if not exists market_snapshot (
  id uuid primary key default gen_random_uuid(),
  fetched_at timestamptz not null default now(),
  indicators_json jsonb not null default '[]'::jsonb,
  headlines_json jsonb not null default '[]'::jsonb
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on transactions (user_id, transaction_date);
create index if not exists documents_user_idx on documents (user_id, reviewed);

alter table transactions   enable row level security;
alter table documents      enable row level security;
alter table risk_settings  enable row level security;
alter table profiles       enable row level security;
alter table market_snapshot enable row level security;

drop policy if exists "own transactions" on transactions;
drop policy if exists "own documents" on documents;
drop policy if exists "own risk settings" on risk_settings;
drop policy if exists "own profile" on profiles;
drop policy if exists "read market snapshot" on market_snapshot;

create policy "own transactions"  on transactions  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own documents"     on documents     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own risk settings" on risk_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own profile"       on profiles      for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "read market snapshot" on market_snapshot for select using (true);

-- ---------------------------------------------------------------------------
-- Row Level Security: the database's own copy of the ownership rule
-- ---------------------------------------------------------------------------
-- The backend talks to Postgres with the service key, so its queries are
-- already filtered by user_id in db.py. RLS is the second lock: it is what makes
-- the anon key in the browser harmless. Every table that holds user data must
-- have RLS enabled and an owner policy — tests/test_schema_rls.py fails the
-- build if a table is added without one.
--
-- market_snapshot is the one deliberate exception: it holds public market
-- numbers and is readable by anyone, but only the service role can write it.

drop policy if exists "own transactions: select" on transactions;
drop policy if exists "own transactions: insert" on transactions;
drop policy if exists "own transactions: update" on transactions;
drop policy if exists "own transactions: delete" on transactions;
drop policy if exists "own documents: select" on documents;
drop policy if exists "own documents: insert" on documents;
drop policy if exists "own documents: update" on documents;
drop policy if exists "own documents: delete" on documents;
drop policy if exists "own risk settings: select" on risk_settings;
drop policy if exists "own risk settings: insert" on risk_settings;
drop policy if exists "own risk settings: update" on risk_settings;
drop policy if exists "own risk settings: delete" on risk_settings;
drop policy if exists "own profile: select" on profiles;
drop policy if exists "own profile: update" on profiles;

create policy "own transactions: select" on transactions for select using (auth.uid() = user_id);
create policy "own transactions: insert" on transactions for insert with check (auth.uid() = user_id);
create policy "own transactions: update" on transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own transactions: delete" on transactions for delete using (auth.uid() = user_id);

create policy "own documents: select" on documents for select using (auth.uid() = user_id);
create policy "own documents: insert" on documents for insert with check (auth.uid() = user_id);
create policy "own documents: update" on documents for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own documents: delete" on documents for delete using (auth.uid() = user_id);

create policy "own risk settings: select" on risk_settings for select using (auth.uid() = user_id);
create policy "own risk settings: insert" on risk_settings for insert with check (auth.uid() = user_id);
create policy "own risk settings: update" on risk_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own risk settings: delete" on risk_settings for delete using (auth.uid() = user_id);

create policy "own profile: select" on profiles for select using (auth.uid() = id);
create policy "own profile: update" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Retention sweeps and the "recent first" ordering both read created_at.
create index if not exists transactions_user_created_idx on transactions (user_id, created_at desc);
create index if not exists documents_user_created_idx on documents (user_id, created_at desc);

-- Storage: uploaded scans live under <user_id>/… in the `documents` bucket.
-- Configure the equivalent policy in the Supabase dashboard (Storage → Policies):
--   select/insert/delete for authenticated where (storage.foldername(name))[1] = auth.uid()::text
-- The backend deletes objects on account deletion and on retention expiry.
