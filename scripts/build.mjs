// Builds the extension into dist/ using three Vite passes:
//  1. popup (HTML) + background service worker  -> ES modules
//  2. content script                            -> single IIFE (content scripts can't be modules)
//  3. MAIN-world bridge                         -> single IIFE
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const watch = process.argv.includes('--watch');
const alias = { '@': resolve(root, 'src') };
const common = { root, configFile: false, logLevel: 'info', resolve: { alias } };
const watchOpt = watch ? {} : null;

const iife = (entry, name, fileName) => ({
  ...common,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    minify: !watch,
    sourcemap: true,
    watch: watchOpt,
    lib: { entry: resolve(root, entry), name, formats: ['iife'], fileName: () => fileName },
  },
  define: { 'process.env.NODE_ENV': '"production"' },
});

await build({
  ...common,
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: !watch,
    watch: watchOpt,
    rollupOptions: {
      input: { popup: resolve(root, 'popup.html'), background: resolve(root, 'src/background/index.ts') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash].[ext]' },
    },
  },
});
await build(iife('src/content/index.ts', 'MiniTeleparty', 'content.js'));
await build(iife('src/player/bridge.ts', 'MiniTelepartyBridge', 'bridge.js'));

copyFileSync(resolve(root, 'manifest.json'), resolve(root, 'dist/manifest.json'));
if (existsSync(resolve(root, 'public/icons'))) {
  mkdirSync(resolve(root, 'dist/icons'), { recursive: true });
  cpSync(resolve(root, 'public/icons'), resolve(root, 'dist/icons'), { recursive: true });
}
console.log('\n✓ Extension built in dist/ — load it via chrome://extensions → Load unpacked');
