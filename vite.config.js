import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
 
export default defineConfig({
  base: '/', 
  plugins: [react()],
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  server: {
    fs: {
      strict: false,
    },
   
    historyApiFallback: true, 
  },
});
