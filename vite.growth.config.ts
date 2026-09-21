import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'growth',
  publicDir: '../public',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist-growth', emptyOutDir: true },
})
