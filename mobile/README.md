# TeamSync Mobil (Android)

Telefon sürümü. Sürüm numarası masaüstünden **ayrıdır**:

| | Sürüm kaynağı | GitHub etiketi | Release başlığı |
|---|---|---|---|
| PC | `package.json` | `v1.0.18` | `1.0.18 PC` |
| Mobil | `mobile/package.json` | `mobil-v1.0.1` | `1.0.1 Mobil` |

## Şu anki durum: 1.0.1 (deneme, Faz 0)
- Masaüstündeki bir **sesli odaya oda kimliğiyle katılma** (aynı MQTT + WebRTC protokolü).
- Ekran kilitliyken görüşmenin sürmesi için ön plan servisi (`CallService.java`).
- Ahize / hoparlör seçimi, kulağa yaklaşınca ekranın kapanması.
- Hesap, arkadaşlar ve mesajlar sonraki sürümlerde gelecek.

## Derleme
```bash
cd mobile
npm install
npm run apk:debug     # android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:release   # imzalı; android/keystore.properties gerekir (depoya girmez)
```
Android SDK yolu `android/local.properties` içindedir (`sdk.dir=...`).

## Yayın
`mobile/package.json` sürümünü yükselt, `main`'e push et:
`.github/workflows/mobile-release.yml` imzalı APK'yı derleyip `mobil-vX.Y.Z` release'i
açar (`--latest=false`, böylece PC'lerin otomatik güncellemesi etkilenmez).

## Yapı
- `src/net/mqtt-multi.js` — 3 broker'a aynı anda bağlanan istemci (masaüstüyle aynı davranış)
- `src/net/room.js` — oda protokolü (hello / signal / `app` veri kanalı)
- `src/native.js` — Java eklentisi köprüsü (`TsCallPlugin.java`)
- `vite.config.mjs` — `vendor/mqtt.min.js` ve simgeyi masaüstü deposundan kopyalar
