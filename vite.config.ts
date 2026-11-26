import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/\/node_modules\/hls\.js\//.test(id)) return 'hls'
          if (/\/node_modules\/(qrcode|dijkstrajs|pngjs)\//.test(id)) return 'qrcode'
          if (/\/node_modules\/lucide-react\//.test(id)) return 'icons'
          if (/\/node_modules\/(nostr-tools|@noble\/|@scure\/)/.test(id)) return 'nostr'
          if (
            /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|zustand)\//.test(
              id,
            )
          ) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
