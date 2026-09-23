import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      '@cs': path.resolve(__dirname, './src/features/intelligence'),
      '@': path.resolve(__dirname, './src'),
      // ContractSense screens are ported from Next.js; these four imports
      // resolve to small react-router shims (src/features/intelligence/shims).
      'next/link': path.resolve(__dirname, './src/features/intelligence/shims/next-link.tsx'),
      'next/navigation': path.resolve(__dirname, './src/features/intelligence/shims/next-navigation.ts'),
      'next/dynamic': path.resolve(__dirname, './src/features/intelligence/shims/next-dynamic.tsx'),
      'next/image': path.resolve(__dirname, './src/features/intelligence/shims/next-image.tsx'),
    },
  },
  // Next's build-time env, as ported screens read it. The intelligence API is
  // same-origin under /intel (proxied below in dev, by nginx when deployed).
  define: {
    'process.env.NEXT_PUBLIC_EXTRACTOR_API_URL': JSON.stringify('/intel/api/v1'),
    'process.env.NEXT_PUBLIC_API_URL': JSON.stringify('/intel/api/v1'),
    'process.env.NEXT_PUBLIC_AGENT_DEMO_MODE': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_BRANCH_ENV': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID': JSON.stringify(''),
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      // The intelligence service (apps/intelligence, FastAPI). Both APIs
      // live under /api/v1, so this one is mounted at /intel and the prefix
      // is stripped on the way through.
      '/intel': {
        target: process.env.INTEL_API_URL ?? 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/intel/, ''),
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
