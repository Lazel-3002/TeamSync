# 🎙️ TeamSync / TeamSync

🚀 Discord arayüzü tanıdıklığında, tamamen merkeziyetsiz (P2P) çalışan sunucusuz bir sesli/görüntülü/ekran paylaşımı ve uzaktan kontrol uygulaması. Ortada verilerinizi saklayan şirketler veya sunucu maliyetleri yok; kullanıcılar doğrudan birbirine bağlanır. Güvenli, hafif ve tamamen gizlilik odaklı modern bir alternatif! Sunucusuz ve websiz (tarayıcı gerektirmez) native masaüstü uygulamasıdır.

## ⚡ Hızlı Başlangıç

1. Bu klasörde bir terminal / terminal penceresi açın.
2. `npm install` yazarak bağımlılıkları indirin.
3. `npm start` yazarak uygulamayı yerelde test edin.
4. Kuruluma gerek kalmayan taşınabilir sürümünü almak için: `npm run build` komutunu çalıştırın. Dosya `dist/` klasöründe hazır olacaktır.

### Bağlantı sorunlarını teşhis etme

Biri bağlanamıyorsa sebebini tahmin etmeye gerek yok:

```bash
npm run diag:net
npm run diag:net -- --turn turn:sunucu.com:3478 --user AD --pass SIFRE
```

Bu komut STUN erişimini, NAT tipini (simetrik NAT doğrudan P2P'yi öldürür),
CGNAT olup olmadığını (mobil veride tipik, `100.64.0.0/10`), Cloudflare WARP
tünelini, sinyalleşme brokerlarını ve — verilirse — TURN sunucusuna gerçek bir
Allocate isteğini tek tek ölçer ve sonunda o ağda sesin kurulup kurulamayacağını
açıkça söyler.

> **Mobil veri notu:** mobil operatörler CGNAT kullanır. CGNAT adresi dışarıdan
> erişilemez (port yönlendirme işe yaramaz, o bağlantıda relay barındırılamaz),
> ama NAT *cone* tipindeyse giden bağlantıyla delik açma yine de kurulur. Ses
> ancak NAT **simetrikse** kurulamaz; o zaman tek yol TURN relay'dir. Ayarlar >
> Bağlantılar bölümüne çalışan bir TURN sunucusu girilmelidir — odada **tek
> kişinin** girmesi yeterlidir, bilgiler diğer katılımcılara otomatik paylaşılır.

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

