import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build the SPA to /dist (Netlify publishes it). SheetJS (xlsx) is large and
// only needed for upload parsing + Excel export, so it's dynamically imported
// and Vite splits it into its own lazy chunk automatically.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
