import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import packageJson from './package.json';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
    'process.env.APP_VERSION': JSON.stringify(packageJson.version),
  },
  build: {
    emptyOutDir: false,
    outDir: `build_version/${packageJson.name}`,
    lib: {
      entry: resolve(__dirname, 'src/content.ts'),
      name: 'contentScript',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});