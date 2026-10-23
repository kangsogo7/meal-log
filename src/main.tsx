import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import { applyTheme, getTheme } from "./theme";
import { initKeyboard } from "./keyboard";
import { initInvites } from "./invite";
import { initFoodShare } from "./foodShare";
import { initReminders } from "./notify";
import { DEFAULT_SETTINGS, getKV, setKV } from "./db";
import "./styles.css";

// 기본 모델을 3.6으로 바꾼 뒤 한 번만: 예전 기본값(3.8)을 쓰던 설정도 3.6으로
(async () => {
  if (await getKV("model36", false)) return;
  const s = await getKV("settings", DEFAULT_SETTINGS);
  if (s.geminiModel === "gemini-3.8-flash") await setKV("settings", { ...s, geminiModel: "gemini-3.6-flash" });
  await setKV("model36", true);
})().catch(() => {});

// 앱(안드로이드·아이폰) 안에서는 서비스 워커가 필요 없음
if (!Capacitor.isNativePlatform()) registerSW({ immediate: true });
applyTheme(getTheme());
initKeyboard();
initInvites();
initFoodShare();
initReminders();

// 브라우저가 저장 공간을 마음대로 비우지 않도록 요청 (기록 보호)
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
