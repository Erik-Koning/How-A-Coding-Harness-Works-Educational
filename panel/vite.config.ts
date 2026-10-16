import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // served from the shim's own static handler, so use relative asset paths
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
