// 키보드가 올라와도 창(시트·전체 화면)이 보이는 영역 안에 있게.
// 아이폰은 키보드가 떠도 화면 크기가 그대로라, 실제로 보이는 영역(visualViewport)의 위치·높이를 CSS 변수로 넘김.
// 앱이 직접 스크롤을 움직이는 건 딱 한 경우: 입력 중인 칸이 키보드에 가려졌을 때, 그 창 안에서만 가려진 만큼.

function revealFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !(el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  const box = el.closest(".sheet-body, .screen-body");
  if (!box) return;
  const vv = window.visualViewport;
  const bottom = Math.min(box.getBoundingClientRect().bottom, (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight));
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
  // 키보드가 올라오는 동안(아이폰은 resize가 늦게 오기도 함) 몇 번 확인. 가려지지 않았으면 아무것도 안 함
  document.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest?.(".sheet-body, .screen-body")) return;
    for (const ms of [300, 600]) setTimeout(() => { update(); revealFocused(); }, ms);
  });
  update();
}
