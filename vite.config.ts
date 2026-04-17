import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['defaults', 'Android >= 5', 'Chrome >= 49', 'Safari >= 10', 'iOS >= 10'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
})
