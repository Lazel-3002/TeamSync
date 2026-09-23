-- ============================================================================
-- TeamSync — Profil arka planı + hareketli (GIF) avatar kurulumu
-- ----------------------------------------------------------------------------
-- avatars_bucket.sql'den SONRA, Supabase panelinde SQL Editor > New query
-- içine yapıştırıp "Run" ile bir kez çalıştırın (tekrar çalıştırılabilir).
--
-- Ne değişir:
--   • Her kullanıcı artık şu yollara da yazabilir:
--       {kullanıcı_id}/avatar_anim.gif
--       {kullanıcı_id}/banner.gif | .jpg | .png | .webp
--     (eski {kullanıcı_id}.jpg profil fotoğrafı aynen çalışmaya devam eder)
--   • Kova dosya sınırı 5 MB, yalnızca resim türleri kabul edilir.
--   • profiles tablosuna isteğe bağlı profile_ext sütunu eklenir: bio, çerçeve,
--     renkler vb. başka bir bilgisayardan girişte de geri gelsin diye. Mesaj
--     İÇERİĞİ Supabase'e YAZILMAZ; bu yalnızca birkaç yüz baytlık profil ayarı.
-- ============================================================================

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
 where id = 'avatars';

drop policy if exists "Avatar upload own" on storage.objects;
drop policy if exists "Avatar update own" on storage.objects;
drop policy if exists "Avatar delete own" on storage.objects;

create policy "Avatar upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars' and (
      name = auth.uid()::text || '.jpg'
      or name ~ ('^' || auth.uid()::text || '/(avatar_anim\.gif|banner\.(gif|jpg|png|webp))$')
    )
  );

create policy "Avatar update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars' and (
      name = auth.uid()::text || '.jpg'
      or name ~ ('^' || auth.uid()::text || '/(avatar_anim\.gif|banner\.(gif|jpg|png|webp))$')
    )
  );

create policy "Avatar delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars' and (
      name = auth.uid()::text || '.jpg'
      or name ~ ('^' || auth.uid()::text || '/(avatar_anim\.gif|banner\.(gif|jpg|png|webp))$')
    )
  );

-- "Avatar public read" (avatars_bucket.sql) olduğu gibi kalır.

alter table public.profiles add column if not exists profile_ext jsonb;
