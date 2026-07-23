import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@engine': resolve(__dirname, 'src/engine'),
  '@store': resolve(__dirname, 'src/store'),
  '@components': resolve(__dirname, 'src/components')
}

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { main: resolve(__dirname, 'electron/main.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { preload: resolve(__dirname, 'electron/preload.ts') } }
    }
  },
  renderer: {
    root: __dirname,
    resolve: { alias },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: { index: resolve(__dirname, 'index.html') } }
    }
  }
})
