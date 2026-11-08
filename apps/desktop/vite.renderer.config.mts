import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer bundle configuration.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
});
