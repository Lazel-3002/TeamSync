-- ============================================================================
-- TeamSync — Profil fotoğrafları için Supabase Storage kurulumu
-- ----------------------------------------------------------------------------
-- Bu betiği Supabase panelinde: SQL Editor > New query içine yapıştırıp
-- "Run" ile bir kez çalıştırın. Profil fotoğrafları artık base64 yerine
-- "avatars" bucket'ında {kullanıcı_id}.jpg olarak saklanır ve public URL ile
-- gösterilir.
-- ============================================================================

-- 1) Public "avatars" bucket'ı oluştur (varsa public yap).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- 2) Erişim politikaları (idempotent — tekrar çalıştırılabilir).
drop policy if exists "Avatar public read"  on storage.objects;
drop policy if exists "Avatar upload own"   on storage.objects;
drop policy if exists "Avatar update own"   on storage.objects;
drop policy if exists "Avatar delete own"   on storage.objects;

-- Herkes avatarları okuyabilir (arkadaşların fotoğrafını görebilmesi için).
create policy "Avatar public read"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

-- Kullanıcı yalnızca kendi kimliğine ait dosyayı yükleyebilir/güncelleyebilir/silebilir.
create policy "Avatar upload own"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'avatars' and name = auth.uid()::text || '.jpg' );

create policy "Avatar update own"
  on storage.objects for update to authenticated
  using ( bucket_id = 'avatars' and name = auth.uid()::text || '.jpg' );

create policy "Avatar delete own"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'avatars' and name = auth.uid()::text || '.jpg' );
