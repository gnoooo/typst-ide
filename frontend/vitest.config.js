import { defineConfig } from 'vitest/config'
import path from 'path'

// Vitest must run from the frontend/ root, not the Vite `root: src`
// (see vite.config.js) so that tests/ is picked up.
export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    include: ['tests/**/*.test.js'],
  },
})