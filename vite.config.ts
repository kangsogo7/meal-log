import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages 저장소 이름과 같아야 합니다 (https://<아이디>.github.io/meal-log/)
const BASE = "/meal-log/";

// 설정 화면에 보여 줄 버전 (빌드 시각, 한국 시간)
const VERSION = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

// `vite build --mode native`: 안드로이드·아이폰 앱용 (앱 안에서 / 경로로 열리고 서비스 워커 불필요)
export default defineConfig(({ command, mode }) => ({
  base: command === "build" && mode !== "native" ? BASE : "/",
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    react(),
    VitePWA({
      disable: mode === "native",
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
            urlPattern: /(food-db|products)\.json$/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "food-db" },
          },
        ],
      },
    }),
  ],
}));
