import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsConfigPaths(),
    tanstackStart({
      srcDirectory: "src",
      router: { entry: "router.tsx" },
      server: { entry: "server.ts" },
    }),
    viteReact(),
    nitro(),
    VitePWA({
      // TanStack Start's Nitro server serves static files from this directory.
      outDir: ".output/public",
      registerType: "prompt",
      // Registration is done manually in src/routes/__root.tsx (SSR-safe, prod-only).
      injectRegister: null,
      devOptions: {
        // Keep the SW off in dev: it intercepts Vite's unbundled modules and breaks HMR.
        enabled: false,
      },
      manifest: {
        id: "miow-lms",
        name: "Integrated Developmental School Online Workspace (MIOW)",
        short_name: "MIOW LMS",
        description:
          "Integrated Developmental School (MIOW): RFID kiosk attendance, courses, timed worksheets, and DepEd-compliant grading.",
        start_url: "/auth",
        scope: "/",
        display: "standalone",
        orientation: "any",
        theme_color: "#800000",
        background_color: "#0D1B2A",
        categories: ["education", "productivity"],
        icons: [
          { src: "/pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // SSR/Nitro build has no static index.html — Workbox would fail the build
        // trying to precache a nonexistent navigation fallback.
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2,webmanifest,html}"],
        // shiki's 10 MB syntax-highlight bundle is lazy-loaded only when a
        // message needs highlighting — precaching it would cost every install.
        globIgnores: ["**/assets/shiki-*.js"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          // Never store SSR navigations: the HTML can contain account-specific data.
          // A static, precached offline page is used only when the network request fails.
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkOnly",
            options: {
              precacheFallback: { fallbackURL: "/offline.html" },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts")) return "recharts";
          if (id.includes("node_modules/framer-motion") || id.includes("node_modules/motion"))
            return "motion";
          if (id.includes("node_modules/shiki")) return "shiki";
          return undefined;
        },
      },
    },
  },
});
