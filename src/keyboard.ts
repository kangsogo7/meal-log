// 키보드가 올라와도 입력 중인 칸이 가려지지 않게.
// 아이폰은 키보드가 떠도 화면 크기가 그대로라, 실제로 보이는 영역(visualViewport)에 맞춰
// 창(시트·전체 화면)의 위치·높이를 CSS 변수로 넘기고, 입력칸을 보이는 곳으로 스크롤함.

const isField = (el: Element | null): el is HTMLElement =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);

function revealFocused() {
  const el = document.activeElement;
  if (!isField(el)) return;
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const bottom = top + (vv?.height ?? window.innerHeight);
  const r = el.getBoundingClientRect();
  if (r.top >= top + 8 && r.bottom <= bottom - 8) return;
  // 창(시트·전체 화면) 안이면 그 창의 스크롤만 움직임 — 뒤 화면까지 같이 밀리지 않게
  const box = el.closest(".sheet-body, .screen-body");
  if (box) {
    const b = box.getBoundingClientRect();
    const visTop = Math.max(b.top, top);
    const visBottom = Math.min(b.bottom, bottom);
    box.scrollTop += r.top + r.height / 2 - (visTop + visBottom) / 2;
  } else if (!document.body.classList.contains("no-scroll")) {
    el.scrollIntoView({ block: "center" });
  }
}

export function initKeyboard() {
  const root = document.documentElement.style;
  const vv = window.visualViewport;
  let timer = 0;
  const update = () => {
    if (vv) {
      root.setProperty("--vv-top", `${vv.offsetTop}px`);
      root.setProperty("--vv-h", `${vv.height}px`);
    }
    // 키보드가 다 올라온 뒤에 한 번 확인
    clearTimeout(timer);
    timer = window.setTimeout(revealFocused, 60);
  };
  vv?.addEventListener("resize", update);
  vv?.addEventListener("scroll", update);
  document.addEventListener("focusin", (e) => {
    if (isField(e.target as Element)) setTimeout(revealFocused, 300);
  });
  // 입력하는 동안 아래 목록이 바뀌어도(검색 결과 등) 입력칸이 화면 밖으로 밀리지 않게
  document.addEventListener("input", () => requestAnimationFrame(revealFocused));
  update();
}
