import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@hollowsolve/match': path.resolve(__dirname, 'src/match-browser.ts'),
    },
  },
})
