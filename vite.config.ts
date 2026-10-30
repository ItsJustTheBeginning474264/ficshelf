import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), VitePWA({ registerType: 'autoUpdate',
    manifest: { name: 'FicShelf', short_name: 'FicShelf', display: 'standalone',
      background_color: '#17141c', theme_color: '#17141c', start_url: '.',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] },
    workbox: { globPatterns: ['**/*.{js,css,html,svg}'] } })],
  test: { environment: 'node' }
})
