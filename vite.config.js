import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Set the base path to match your GitHub repository name
  base: '/LaPuffOnline/',
  
  logLevel: 'error', // Suppress warnings, only show errors
  
  plugins: [
    react(),
  ],
  
  // Optional: Ensures your build output matches what GitHub Actions expects
  build: {
    outDir: 'dist',
  }
});