// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
 
export default defineConfig({
  base: '/geo/',
  plugins: [react()],
  build: {
    commonjsOptions: {
      transformMixedEsModules: true, // Specifically fixes 'require' issues in dependencies
    },
  },
});