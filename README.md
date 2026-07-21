# 🎙️ TeamSync / TeamSync

🚀 Discord arayüzü tanıdıklığında, tamamen merkeziyetsiz (P2P) çalışan sunucusuz bir sesli/görüntülü/ekran paylaşımı ve uzaktan kontrol uygulaması. Ortada verilerinizi saklayan şirketler veya sunucu maliyetleri yok; kullanıcılar doğrudan birbirine bağlanır. Güvenli, hafif ve tamamen gizlilik odaklı modern bir alternatif! Sunucusuz ve websiz (tarayıcı gerektirmez) native masaüstü uygulamasıdır.

## ⚡ Hızlı Başlangıç

1. Bu klasörde bir terminal / terminal penceresi açın.
2. `npm install` yazarak bağımlılıkları indirin.
3. `npm start` yazarak uygulamayı yerelde test edin.
4. Kuruluma gerek kalmayan taşınabilir sürümünü almak için: `npm run build` komutunu çalıştırın. Dosya `dist/` klasöründe hazır olacaktır.

### RNNoise gürültü engelleme

Uygulamadaki RNNoise seçeneği, ücretsiz ve açık kaynak RNNoise modelini 48 kHz
mono mikrofon zincirinde bir AudioWorklet içinde çalıştırır. WASM dosyaları
uygulamayla birlikte yerel olarak gelir; hesap, API anahtarı veya internet
bağlantısı gerekmez. AudioWorklet başlatılamazsa çağrı kesilmeden Chromium'un
sistem gürültü engellemesine otomatik dönülür.

## Proje Yapısı

- `assets/` — uygulama görselleri
- `electron/` — tepsi ve bildirim pencereleri
- `js/` — ana arayüz modülleri
- `src/` — React geliştirme arayüzü
- `test/` — otomatik ve elle çalıştırılan testler
- `tools/` — veri üretme, bakım ve eski dönüşüm araçları
- `vendor/` — uygulamayla birlikte dağıtılan üçüncü taraf dosyalar

`node_modules/`, `dist/` ve `src/dist-react/` yeniden üretilebildikleri için Git tarafından izlenmez.

