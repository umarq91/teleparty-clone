import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ root: import.meta.dirname, resolve: { alias: { '@': resolve(import.meta.dirname, '../src') } }, server: { port: 5199, strictPort: true } });
