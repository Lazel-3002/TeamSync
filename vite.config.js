import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src',
  plugins: [react()],
  base: './', // For electron compatibility
  build: {
    outDir: 'dist-react',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  }
});
