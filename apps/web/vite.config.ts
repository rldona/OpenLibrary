import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo la API corre en :8080; Vite la reenvía para que todo sea mismo origen (cookies y CSRF).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: true },
});
