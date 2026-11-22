import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'));

// Masaüstüyle ortak dosyalar (tek kaynak masaüstü deposu): build ve dev
// başlarken public/ içine kopyalanır, elle kopya tutulmaz.
const SHARED = [
  ['../vendor/mqtt.min.js', 'vendor/mqtt.min.js'],
  ['../assets/icon.png', 'icon.png'],
  // Gürültü engelleme (masaüstündekiyle aynı RNNoise)
  ['../js/rnnoise-noise-suppression.js', 'rnnoise-noise-suppression.js'],
  ['../vendor/rnnoise/workletProcessor.js', 'vendor/rnnoise/workletProcessor.js'],
  ['../vendor/rnnoise/rnnoise.wasm', 'vendor/rnnoise/rnnoise.wasm'],
  ['../vendor/rnnoise/rnnoise_simd.wasm', 'vendor/rnnoise/rnnoise_simd.wasm'],
  ['../vendor/rnnoise/LICENSE-RNNoise-BSD-3-Clause.txt', 'vendor/rnnoise/LICENSE-RNNoise-BSD-3-Clause.txt'],
  ['../vendor/rnnoise/LICENSE-rnnoise-wasm.txt', 'vendor/rnnoise/LICENSE-rnnoise-wasm.txt'],
  ['../vendor/rnnoise/LICENSE-web-noise-suppressor.txt', 'vendor/rnnoise/LICENSE-web-noise-suppressor.txt'],
];
// Web sürümü ana ekrana eklenebilsin (iPhone: Safari > Paylaş > Ana Ekrana Ekle).
const WEB_MANIFEST = {
  name: 'TeamSync', short_name: 'TeamSync', start_url: './', display: 'standalone',
  background_color: '#1e1828', theme_color: '#1e1828', lang: 'tr',
  icons: [{ src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
};
function copyShared() {
  return {
    name: 'teamsync-shared',
    buildStart() {
      for (const [from, to] of SHARED) {
        const dest = resolve(here, 'public', to);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(resolve(here, from), dest);
      }
      writeFileSync(resolve(here, 'public', 'manifest.webmanifest'), JSON.stringify(WEB_MANIFEST, null, 2));
    },
  };
}

export default defineConfig({
  root: resolve(here, 'src'),
  publicDir: resolve(here, 'public'),
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [copyShared()],
  // Web sürümü: npm run build:web → docs/app (GitHub Pages).
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true, target: 'es2022' },
});
