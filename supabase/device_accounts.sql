-- Cihaz kimlikleri: hangi hesabın hangi cihazda açıldığı.
-- Her girişte uygulama (renderer.js registerDeviceAccount) kendi satırını
-- günceller. Kullanıcılar yalnızca kendi satırlarını görebilir; tamamı
-- Supabase panelinde (Table Editor > device_accounts) görülür.
--   device_id : bu bilgisayarın kimliği (main.js deriveDeviceId, 40 hex)
--   kind      : 'local' = bu cihazda oluşturulan hesap, 'code' = giriş koduyla eklenen
create table if not exists public.device_accounts (
  device_id text not null check (device_id ~ '^[0-9a-f]{40}$'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  friend_id text,
  account_name text,
  kind text not null default 'local' check (kind in ('local', 'code')),
  app_version text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (device_id, user_id)
);

create index if not exists device_accounts_user_id_idx on public.device_accounts (user_id);

alter table public.device_accounts enable row level security;

create policy "device_accounts_select_own" on public.device_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "device_accounts_insert_own" on public.device_accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "device_accounts_update_own" on public.device_accounts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
