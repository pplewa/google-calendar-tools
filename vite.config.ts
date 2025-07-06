import { defineConfig, loadEnv } from 'vite'
import { crx } from '@crxjs/vite-plugin'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables
  const env = loadEnv(mode, process.cwd(), '')
  
  // Set environment variables so they're available when importing manifest
  process.env = { ...process.env, ...env }
  
  // Import manifest after environment variables are loaded
  const manifest = require('./src/manifest.config').default
  
  return {
    build: {
      emptyOutDir: true,
      outDir: 'build',
      rollupOptions: {
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
    plugins: [
      crx({ 
        manifest,
        contentScripts: {
          injectCss: true,
        },
      })
    ],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
  }
})
