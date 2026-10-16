import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const isHosted = mode === 'hosted';
  const base = isHosted ? '/' : '/I-DOJO/';

  return {
    base,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/I-DOJO/api': {
          target: 'http://localhost:5000',
          rewrite: (path) => path.replace('/I-DOJO', ''),
        },
        '/I-DOJO/uploads': {
          target: 'http://localhost:5000',
        },
      },
    },
    build: {
      outDir: isHosted ? 'dist' : '../backend/build',
      emptyOutDir: true,
    },
  };
});
