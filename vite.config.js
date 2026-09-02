import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/web',
  /* fix M7: publicDir relatif terhadap root (src/web) — dulu 'public' menunjuk src/web/public
     yang tidak ada, sehingga manifest/sw/ikon 404 saat `npm run dev` */
  publicDir: '../../public',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist', emptyOutDir: true },
});
