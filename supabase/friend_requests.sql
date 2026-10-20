-- Arkadaşlık istekleri: kalıcı posta kutusu.
--
-- Eskiden istek yalnızca MQTT'ye (QoS 0, retain yok) atılıyordu: alıcı o an
-- çevrimdışıysa istek sonsuza dek kayboluyor, olmayan bir ID'ye gönderilen
-- istek de "gönderildi" diyordu. Artık istek önce burada saklanır; alıcı
-- açılışta ve periyodik olarak kendi gelen isteklerini çeker. Kabul de aynı
-- satır üzerinden gönderene ulaşır (gönderen çevrimdışı olsa bile).
--
-- Tabloya doğrudan erişim yok (RLS açık, politika yok); her şey aşağıdaki
-- SECURITY DEFINER fonksiyonlarından geçer ve çağıranın kimliği
-- profiles.friend_id üzerinden auth.uid()'den türetilir.

create table if not exists public.friend_requests (
  from_id    text not null,
  to_id      text not null,
  from_name  text,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (from_id, to_id)
);
create index if not exists friend_requests_to_id_idx on public.friend_requests (to_id);

alter table public.friend_requests enable row level security;
revoke all on public.friend_requests from anon, authenticated;

create or replace function public.my_friend_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select friend_id from public.profiles where id = auth.uid()
$$;

-- Sonuç kodları: ok | not_found | self | already_friends | no_profile | rate_limited
create or replace function public.send_friend_request(p_to text, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := public.my_friend_id();
  target text := upper(trim(coalesce(p_to, '')));
begin
  if me is null then return 'no_profile'; end if;
  if target = '' or target = me then return 'self'; end if;
  if not exists (select 1 from public.profiles where friend_id = target) then
    return 'not_found';
  end if;
  if exists (
    select 1 from public.profiles
    where id = auth.uid() and friends ? target and coalesce((friends -> target ->> 'temporary')::boolean, false) = false
  ) then
    return 'already_friends';
  end if;
  if (select count(*) from public.friend_requests
      where from_id = me and created_at > now() - interval '1 hour') >= 60 then
    return 'rate_limited';
  end if;
  insert into public.friend_requests (from_id, to_id, from_name)
  values (me, target, left(coalesce(nullif(trim(p_name), ''), me), 60))
  on conflict (from_id, to_id) do update
    set from_name = excluded.from_name, status = 'pending', created_at = now(), updated_at = now();
  return 'ok';
end;
$$;

-- Bana gelen ve benim gönderdiğim istekler (son 60 gün). to_name: giden
-- isteklerde karşının güncel adı (kabul edilince arkadaş listesine yazılır).
create or replace function public.list_friend_requests()
returns table (from_id text, to_id text, from_name text, to_name text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.from_id, r.to_id, r.from_name,
         (select p.name from public.profiles p where p.friend_id = r.to_id limit 1),
         r.status, r.created_at
  from public.friend_requests r
  where (r.to_id = public.my_friend_id() or r.from_id = public.my_friend_id())
    and r.updated_at > now() - interval '60 days'
  order by r.created_at
$$;

-- Alıcı: kabul edince satır 'accepted' olur (gönderen görünce siler), ret siler.
create or replace function public.respond_friend_request(p_from text, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := public.my_friend_id();
begin
  if me is null then return false; end if;
  if p_accept then
    update public.friend_requests set status = 'accepted', updated_at = now()
    where from_id = p_from and to_id = me;
  else
    delete from public.friend_requests where from_id = p_from and to_id = me;
  end if;
  return found;
end;
$$;

-- Gönderen: isteği iptal eder ya da işlenmiş kabulü temizler.
create or replace function public.clear_friend_request(p_to text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := public.my_friend_id();
begin
  if me is null then return false; end if;
  delete from public.friend_requests where from_id = me and to_id = p_to;
  return found;
end;
$$;

revoke all on function public.my_friend_id() from public, anon;
revoke all on function public.send_friend_request(text, text) from public, anon;
revoke all on function public.list_friend_requests() from public, anon;
revoke all on function public.respond_friend_request(text, boolean) from public, anon;
revoke all on function public.clear_friend_request(text) from public, anon;
grant execute on function public.my_friend_id() to authenticated;
grant execute on function public.send_friend_request(text, text) to authenticated;
grant execute on function public.list_friend_requests() to authenticated;
grant execute on function public.respond_friend_request(text, boolean) to authenticated;
grant execute on function public.clear_friend_request(text) to authenticated;
