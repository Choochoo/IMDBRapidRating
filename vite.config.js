import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const BootstrapCssPath = fileURLToPath(new URL("./node_modules/bootstrap/dist/css/bootstrap.min.css", import.meta.url));

const Config = {
  plugins: [react()],
  resolve: {
    alias: {
      "/vendor/bootstrap.min.css": BootstrapCssPath
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true
  }
};

export default defineConfig(Config);
