import type { CapacitorConfig } from "@capacitor/cli";

// 안드로이드·아이폰 앱(건강 데이터 연동용). 웹 코드는 `npm run build:native`로 만든 dist를 그대로 씀
const config: CapacitorConfig = {
  appId: "io.github.kangsogo7.meallog",
  appName: "식단 기록",
  webDir: "dist",
  android: {
    // 상태 표시줄 아래까지 앱이 그려지도록 (safe-area 처리는 CSS에서)
    adjustMarginsForEdgeToEdge: "auto",
  },
};

export default config;
