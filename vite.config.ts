import { defineConfig } from 'vite';

// `base` is relative so the built site works from a subpath (GitHub Pages
// project sites) as well as from a domain root.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    // The data bundle lives in public/ and is copied verbatim.
    assetsInlineLimit: 4096,
  },
});
