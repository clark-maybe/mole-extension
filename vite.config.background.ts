import { defineConfig } from 'vite';
import { resolve } from 'path';
import packageJson from './package.json';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  define: {
    'process.env': {},
    'process.env.APP_VERSION': JSON.stringify(packageJson.version),
  },
  build: {
    emptyOutDir: false,
    outDir: `build_version/${packageJson.name}_${packageJson.version}`,
    lib: {
      entry: resolve(__dirname, 'src/background.ts'),
      name: 'contentScript',
      formats: ['iife'],
      fileName: () => 'background.js',
    },
  },
});