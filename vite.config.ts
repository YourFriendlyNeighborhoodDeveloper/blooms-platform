import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return 'motion';
          if (id.includes('node_modules/lenis')) return 'lenis';
        },
      },
    },
  },
});
