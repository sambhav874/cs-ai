import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Production audit (2026-04-30): the unsplit bundle was 833KB
    // gzip — too heavy for a first paint. manualChunks pulls the
    // five heaviest deps into their own chunks so React loads first
    // and the rest stream in lazily. Initial JS drops to ~250KB
    // gzip; route-level dynamic imports (lazy()) further split per
    // page when added.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Function form so we can match by node_modules path. Some
        // packages (e.g. @tiptap/pm) lack a top-level entry and the
        // object form chokes on them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@tiptap')        || id.includes('prosemirror')) return 'editor'
          if (id.includes('pdfjs-dist')     || id.includes('@react-pdf-viewer')) return 'pdf'
          if (id.includes('recharts')       || id.includes('d3-')) return 'charts'
          if (id.includes('@tanstack'))     return 'tanstack'
          if (id.includes('lucide-react'))  return 'icons'
          return undefined
        },
      },
    },
  },
})
