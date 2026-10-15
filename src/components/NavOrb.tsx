// 화면 이동: 아래 가운데 동그란 버튼 하나
// - 톡 누르면 식단 화면으로
// - 0.2초 누르고 있으면 동그라미 양옆으로 탭 5개가 펼쳐지고, 손을 떼지 않고 좌우로 밀어서 고른 뒤 떼면 이동
// - 펼친 채로 손을 떼면 메뉴가 남아 있고, 다시 아무 데나 대고 밀어서 고르거나 칸을 눌러 고를 수 있음
// - 조금만 밀어도 한 칸씩 넘어가게 (STEP px마다 한 칸)
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface NavItem<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
}

const HOLD_MS = 200;
/** 손가락을 이만큼(px) 밀 때마다 한 칸 이동 */
const STEP = 22;
/** 이보다 덜 움직이면 미는 게 아니라 누른 것으로 봄 */
const TAP_SLOP = 6;

export function NavOrb<K extends string>({ items, current, home, onSelect }: { items: NavItem<K>[]; current: K; home: K; onSelect: (k: K) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0); // 강조된 칸 번호
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>(0);
  const drag = useRef<{ x: number; base: number; moved: boolean } | null>(null); // 지금 밀고 있는 중
  const row = useRef<HTMLDivElement>(null);
  const curIndex = Math.max(0, items.findIndex((i) => i.key === current));
  const cur = items[curIndex];

  const clamp = (i: number) => Math.min(items.length - 1, Math.max(0, i));
  const close = () => {
    setOpen(false);
    drag.current = null;
  };
  const choose = (i: number) => {
    close();
    onSelect(items[i].key);
  };
  /** 미는 거리 → 칸 번호 */
  const follow = (x: number) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(x - d.x) > TAP_SLOP) d.moved = true;
    setHover(clamp(d.base + Math.round((x - d.x) / STEP)));
  };
  /** 손가락 x 위치 바로 아래 칸 (눌러서 고를 때) */
  const indexAt = (x: number, y: number) => {
    const els = row.current ? [...row.current.querySelectorAll<HTMLElement>("[data-i]")] : [];
    const hit = els.find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom + 12;
    });
    return hit ? Number(hit.dataset.i) : -1;
  };
  const capture = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 못 잡아도 동작은 함 */
    }
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  // ---- 동그라미: 톡 / 길게 눌러 펼치고 그대로 밀기 ----
  const onDown = (e: React.PointerEvent) => {
    if (open) return;
    capture(e);
    const x = e.clientX;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      setHolding(false);
      drag.current = { x, base: curIndex, moved: false };
      setHover(curIndex);
      setOpen(true);
      navigator.vibrate?.(12);
    }, HOLD_MS);
  };
  const onUp = () => {
    setHolding(false);
    if (timer.current) {
      // 0.2초 전에 뗌 → 톡: 식단으로
      clearTimeout(timer.current);
      timer.current = 0;
      onSelect(home);
      return;
    }
    const d = drag.current;
    drag.current = null;
    // 밀었으면 그 칸으로, 제자리에서 뗐으면 메뉴를 열어 둔 채로
    if (d?.moved) choose(hover);
  };
  const onCancel = () => {
    setHolding(false);
    clearTimeout(timer.current);
    timer.current = 0;
    drag.current = null;
  };

  // ---- 펼친 뒤 다시 터치: 아무 데나 대고 밀기, 칸 누르기, 바깥 누르면 닫기 ----
  const layerDown = (e: React.PointerEvent) => {
    capture(e);
    drag.current = { x: e.clientX, base: hover, moved: false };
  };
  const layerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) return choose(hover);
    const i = indexAt(e.clientX, e.clientY);
    if (i >= 0) choose(i);
    else close();
  };

  return (
    <>
      {open && (
        <div
          className="orb-layer"
          onPointerDown={layerDown}
          onPointerMove={(e) => follow(e.clientX)}
          onPointerUp={layerUp}
          onPointerCancel={() => (drag.current = null)}
          onContextMenu={(e) => e.preventDefault()}
          aria-hidden
        />
      )}
      {open && (
        <div className="orb-menu" ref={row} role="menu" aria-label="화면 이동">
          {items.map((t, i) => (
            <button
              key={t.key}
              data-i={i}
              role="menuitem"
              // 가운데(동그라미 자리)에서 양옆으로 펼쳐지는 애니메이션: 가운데로부터 몇 칸 떨어졌는지
              style={{ "--d": i - (items.length - 1) / 2 } as React.CSSProperties}
              className={`${i === hover ? "hover" : ""} ${i === curIndex ? "current" : ""}`}
              onClick={() => choose(i)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`nav-orb ${open ? "open" : ""} ${holding ? "holding" : ""}`}
        aria-label={`${cur.label} 화면. 누르면 식단, 길게 누르면 화면 고르기`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={onDown}
        onPointerMove={(e) => follow(e.clientX)}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onContextMenu={(e) => e.preventDefault()}
        // 키보드 Enter·Space (손가락 누름은 위에서 처리)
        onClick={(e) => { if (e.detail === 0) onSelect(home); }}
        onKeyDown={(e) => {
          // 키보드: 위 화살표로 메뉴 열기
          if (e.key === "ArrowUp") { e.preventDefault(); setHover(curIndex); setOpen(true); }
          if (e.key === "Escape") close();
        }}
      >
        <span className="orb-icon">{cur.icon}</span>
        <span className="orb-label">{cur.label}</span>
        <span className="orb-ring" aria-hidden />
      </button>
    </>
  );
}
