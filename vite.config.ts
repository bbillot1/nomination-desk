import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const replayOnly = process.env.VITE_DESK_MODE === "replay";
  return {
    plugins: [react(), tailwindcss()],
    // A public replay build must remain disconnected even when the developer has a local live
    // configuration. Replacing both values at compile time prevents accidental project linkage.
    define: replayOnly
      ? {
          "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""),
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(""),
        }
      : undefined,
    server: {
      port: 5173,
      strictPort: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  };
});
