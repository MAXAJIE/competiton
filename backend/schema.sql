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
