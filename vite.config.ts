import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // SITE_MODE=production is the single deliberate switch for an owner-approved launch.
    'import.meta.env.VITE_SITE_MODE': JSON.stringify(process.env.SITE_MODE ?? ''),
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787', '/media': 'http://127.0.0.1:8787' },
  },
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
