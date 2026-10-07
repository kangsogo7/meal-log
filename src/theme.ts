// 화면 테마: system(휴대폰 설정 따름) / light / dark. 기기마다 따로 저장
export type Theme = "system" | "light" | "dark";
const KEY = "meal-log-theme";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  // 상태 표시줄 색도 배경에 맞춤
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#232625" : "#e8e8eb");
}

export function setTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // 저장이 안 돼도 지금 화면에는 적용
  }
  applyTheme(t);
}
