import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import { applyTheme, getTheme } from "./theme";
import { initKeyboard } from "./keyboard";
import { initInvites } from "./invite";
import { initFoodShare } from "./foodShare";
import "./styles.css";

// 앱(안드로이드·아이폰) 안에서는 서비스 워커가 필요 없음
if (!Capacitor.isNativePlatform()) registerSW({ immediate: true });
applyTheme(getTheme());
initKeyboard();
initInvites();
initFoodShare();

// 브라우저가 저장 공간을 마음대로 비우지 않도록 요청 (기록 보호)
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
