// 키보드가 올라와도 창(시트·전체 화면)이 보이는 영역 안에 있게.
// 아이폰은 키보드가 떠도 화면 크기가 그대로라, 실제로 보이는 영역(visualViewport)의 위치·높이를 CSS 변수로 넘김.
// 앱이 직접 스크롤을 움직이는 건 딱 한 경우: 입력 중인 칸이 키보드에 가려졌을 때, 그 창 안에서만 가려진 만큼.

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** 지금 키보드 위로 보이는 영역의 아래 끝 (화면 위에서부터 px) */
function visibleBottom() {
  const vv = window.visualViewport;
  const h = window.innerHeight;
  // 키보드가 떴는데 visualViewport가 줄지 않는 경우(일부 아이폰)를 대비해, 화면의 절반 아래는 가려진다고 봄
  if (isIOS && (!vv || vv.height > h * 0.85)) return h * 0.5;
  return vv ? vv.offsetTop + vv.height : h;
}

function revealFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !(el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  const box = el.closest(".sheet-body, .screen-body");
  if (!box) return;
  const bottom = Math.min(box.getBoundingClientRect().bottom, visibleBottom());
  const r = el.getBoundingClientRect();
  if (r.bottom > bottom - 12) box.scrollTop += r.bottom - bottom + 24;
}

export function initKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  const update = () => {
    root.setProperty("--vv-top", `${vv.offsetTop}px`);
    root.setProperty("--vv-h", `${vv.height}px`);
    // 창 아래쪽이 키보드에 가려지는 높이
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
    root.setProperty("--kb", `${kb}px`);
    document.documentElement.classList.toggle("kb-open", kb > 80);
  };
  vv.addEventListener("scroll", update);
  vv.addEventListener("resize", () => {
    update();
    requestAnimationFrame(revealFocused);
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement;
    if (!(t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const box = t.closest?.(".sheet-body, .screen-body");
    if (!box) return;
    // 목록이 짧아도 입력칸을 키보드 위로 올릴 수 있게 아래 여백을 줌 (창을 닫을 때까지 유지 — 여백이 사라지며 화면이 튀지 않게)
    if (isIOS) box.classList.add("typing");
    // 키보드가 다 올라온 뒤 확인. 가려지지 않았으면 아무것도 안 함
    for (const ms of [350, 700]) setTimeout(() => { update(); revealFocused(); }, ms);
  });
  update();
}
