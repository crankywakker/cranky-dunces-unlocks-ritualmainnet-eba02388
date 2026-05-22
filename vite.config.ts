import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Disable Cloudflare Workers build plugin and enable TanStack Start's SPA
// mode so the build produces a static client bundle that Vercel can serve
// directly. SPA mode prerenders a shell HTML used as the SPA fallback for
// every route.
export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
    spa: { enabled: true, maskPath: "/" },
  },
});
