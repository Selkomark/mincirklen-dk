import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Separate build, on purpose: Vite's library mode always merges every
// entry's CSS into one file regardless of cssCodeSplit, AND always names it
// `style.css` with no override — so a second lib build sharing dist/ would
// silently clobber the main entry's style.css with Monaco's ~350KB of
// editor-chrome CSS mixed in. Building into its own dist/code-editor/
// subfolder keeps both entries' JS and CSS output genuinely isolated.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/code-editor',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/components/CodeEditor/index.ts'),
      formats: ['es'],
      fileName: () => 'code-editor.es.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
})
