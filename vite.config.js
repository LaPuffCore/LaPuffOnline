import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // You might need to run 'npm install @types/node' if this errors

export default defineConfig({
  base: '/LaPuffOnline/',
  logLevel: 'error',
  plugins: [react()],
  resolve: {
    alias: {
      // This tells Vite that "@" means the "src" folder okay
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist',
  }
})