import { defineConfig } from 'vite'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'
import path from 'path'

export default defineConfig({
  // build from `src/` so the generated index.html is emitted at dist/index.html
  root: path.resolve(__dirname, 'src'),
  base: './',
  // ensure Vite copies files from frontend/public into the final `dist` even
  // though the dev `root` is set to `src`
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [
    // monacoEditorPlugin({
    //   languageWorkers: ['editorWorkerService', 'json', 'typescript', 'css', 'html'],
    //   publicPath: '',
    //   inlineWorkers: true
    // })
  ],
  optimizeDeps: {
    include: ['monaco-editor']
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      // input is the index.html inside the `root` (src)
      input: {
        index: path.resolve(__dirname, 'src/index.html')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
})
