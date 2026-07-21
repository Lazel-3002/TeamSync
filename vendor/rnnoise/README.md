# RNNoise runtime assets

These local assets power TeamSync's real-time, on-device RNNoise microphone
filter. No CDN, account, API key, or paid service is used.

- `workletProcessor.js`, `rnnoise.wasm`, and `rnnoise_simd.wasm` come from
  `@sapphi-red/web-noise-suppressor@0.3.5`.
- The worklet embeds `@shiguredo/rnnoise-wasm` and Xiph.Org's RNNoise.
- The accompanying license files must remain with redistributed builds.

The npm dependency is pinned in `package.json` and `package-lock.json` so these
assets can be audited and refreshed reproducibly.
