import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set VITE_BASE_PATH to your GitHub repo name in the Actions workflow
// e.g. /pinz-bowling-league/ — leave as './' for local dev
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || './',
})
