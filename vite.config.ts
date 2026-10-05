import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages 저장소 이름과 같아야 합니다 (https://<아이디>.github.io/meal-log/)
const BASE = "/meal-log/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? BASE : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "식단 기록",
        short_name: "식단",
        description: "끼니별 식단과 영양성분을 기록하는 앱",
        lang: "ko",
        display: "standalone",
        background_color: "#f6f7f9",
        theme_color: "#16a34a",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        // 식약처 DB(약 2MB)는 처음 쓸 때 받아서 캐시해 두고 오프라인에서도 사용
        runtimeCaching: [
          {
            urlPattern: /food-db\.json$/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "food-db" },
          },
        ],
      },
    }),
  ],
}));
