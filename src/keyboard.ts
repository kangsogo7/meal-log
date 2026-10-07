// 키보드가 올라와도 창(시트·전체 화면)이 보이는 영역 안에 있게.
// 아이폰은 키보드가 떠도 화면 크기가 그대로라, 실제로 보이는 영역(visualViewport)의 위치·높이를 CSS 변수로 넘김.
// 앱이 직접 스크롤을 움직이는 건 딱 한 경우: 키보드가 올라와서 입력 중인 칸이 가려졌을 때, 그 창 안에서만 한 번.

function revealFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !(el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  const box = el.closest(".sheet-body, .screen-body");
  if (!box) return;
  const vv = window.visualViewport;
  const bottom = Math.min(box.getBoundingClientRect().bottom, (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight));
  const r = el.getBoundingClientRect();
  if (r.bottom > bottom - 8) box.scrollTop += r.bottom - bottom + 16;
}

export function initKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  let lastH = vv.height;
  const update = () => {
    root.setProperty("--vv-top", `${vv.offsetTop}px`);
    root.setProperty("--vv-h", `${vv.height}px`);
  };
  vv.addEventListener("scroll", update);
  vv.addEventListener("resize", () => {
    update();
    // 키보드가 올라와 화면이 줄었을 때만
    if (vv.height < lastH - 100) requestAnimationFrame(revealFocused);
    lastH = vv.height;
  });
  update();
}
