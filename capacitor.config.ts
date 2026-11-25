import type { CapacitorConfig } from "@capacitor/cli";

// 안드로이드·아이폰 앱(건강 데이터 연동용). 웹 코드는 `npm run build:native`로 만든 dist를 그대로 씀
const config: CapacitorConfig = {
  appId: "io.github.kangsogo7.meallog",
  appName: "식단 기록",
  webDir: "dist",
  plugins: {
    // 아이폰: 키보드가 뜨면 앱 화면을 키보드(위 ^ ⌄ ✓ 막대 포함) 위까지 줄임 → 입력칸이 키보드에 가려지지 않게
    Keyboard: { resize: "native" },
  },
  android: {
    // 상태 표시줄 아래까지 앱이 그려지도록 (safe-area 처리는 CSS에서)
    adjustMarginsForEdgeToEdge: "auto",
  },
};

export default config;
