import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { applyTheme, getTheme } from "./theme";
import "./styles.css";

registerSW({ immediate: true });
applyTheme(getTheme());

// 브라우저가 저장 공간을 마음대로 비우지 않도록 요청 (기록 보호)
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
