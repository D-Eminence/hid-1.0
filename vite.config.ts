import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'

function isPackageModule(id: string, packageName: string) {
  return id.includes(`/node_modules/${packageName}/`)
}

export default defineConfig({
  envPrefix: ['VITE_', 'HID'],
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/node_modules/@sentry/')) {
            return 'vendor-sentry'
          }
          if (isPackageModule(id, 'posthog-js')) {
            return 'vendor-posthog'
          }
          if (id.includes('/node_modules/@supabase/')) {
            return 'vendor-supabase'
          }
          if (
            isPackageModule(id, 'react-router-dom') ||
            isPackageModule(id, 'react-router') ||
            id.includes('/node_modules/@remix-run/router/')
          ) {
            return 'vendor-router'
          }
          if (
            isPackageModule(id, 'react') ||
            isPackageModule(id, 'react-dom') ||
            isPackageModule(id, 'scheduler')
          ) {
            return 'vendor-react-core'
          }
          return undefined
        },
      },
    },
  },
})
