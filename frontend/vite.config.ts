import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0", // Cambiado para que Docker pueda mapear el tráfico correctamente
    port: 5173,
    strictPort: true, // Evita que Vite cambie de puerto si el 5173 está ocupado
    watch: {
      usePolling: true, // Necesario para detectar cambios de archivos en volúmenes de Docker
    },
    hmr: {
      clientPort: 5173, // Asegura que el navegador se conecte al puerto correcto para actualizaciones en vivo
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));