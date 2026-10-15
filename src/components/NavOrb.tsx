// 화면 이동: 아래 가운데 동그란 버튼 하나
// - 톡 누르면 식단 화면으로
// - 0.5초 누르고 있으면 탭 5개가 가로로 펼쳐지고, 손을 떼지 않고 좌우로 밀어서 고른 뒤 떼면 이동
// - 길게 눌러 펼친 뒤 그 자리에서 떼면 메뉴가 열린 채로 남아서 눌러 고를 수도 있음
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface NavItem<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
}

const HOLD_MS = 500;

export function NavOrb<K extends string>({ items, current, home, onSelect }: { items: NavItem<K>[]; current: K; home: K; onSelect: (k: K) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<K | null>(null);
  // 누르고 있는 동안 테두리가 0.5초에 걸쳐 채워짐
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>(0);
  const dragging = useRef(false); // 길게 눌러 펼친 뒤 손을 아직 안 뗀 상태
  const startX = useRef(0);
  const row = useRef<HTMLDivElement>(null);
  const cur = items.find((i) => i.key === current) ?? items[0];

  // 손가락 x 위치에서 가장 가까운 탭
  const pick = (x: number) => {
    const els = row.current ? [...row.current.querySelectorAll<HTMLElement>("[data-key]")] : [];
    let best: K | null = null;
    let dist = Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - x);
      if (d < dist) {
        dist = d;
        best = el.dataset.key as K;
      }
    }
    return best;
  };

  const close = () => {
    setOpen(false);
    setHover(null);
    dragging.current = false;
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const onDown = (e: React.PointerEvent) => {
    if (open) return;
    startX.current = e.clientX;
    // 밀어서 버튼 밖으로 나가도 계속 받도록 (못 잡아도 톡·길게 누르기는 동작)
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      setHolding(false);
      dragging.current = true;
      setOpen(true);
      setHover(current);
      navigator.vibrate?.(15);
    }, HOLD_MS);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setHover(pick(e.clientX));
  };
  const onUp = (e: React.PointerEvent) => {
    setHolding(false);
    if (timer.current) {
      // 0.5초 전에 뗌 → 톡: 식단으로
      clearTimeout(timer.current);
      timer.current = 0;
      if (!open) onSelect(home);
      return;
    }
    if (!dragging.current) return;
    dragging.current = false;
    // 거의 안 움직이고 뗐으면 메뉴를 열어 둔 채로 (눌러서 고르기)
    if (Math.abs(e.clientX - startX.current) < 12) return;
    const k = pick(e.clientX);
    close();
    if (k) onSelect(k);
  };
  const onCancel = () => {
    setHolding(false);
    clearTimeout(timer.current);
    timer.current = 0;
    if (dragging.current) close();
  };

  return (
    <>
      {open && <div className="orb-backdrop" onClick={close} aria-hidden />}
      {open && (
        <div className="orb-menu" ref={row} role="menu" aria-label="화면 이동">
          {items.map((t) => (
            <button
              key={t.key}
              data-key={t.key}
              role="menuitem"
              className={`${t.key === hover ? "hover" : ""} ${t.key === current ? "current" : ""}`}
              onClick={() => { close(); onSelect(t.key); }}
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
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onContextMenu={(e) => e.preventDefault()}
        // 키보드 Enter·Space (손가락 누름은 위에서 처리)
        onClick={(e) => { if (e.detail === 0) onSelect(home); }}
        onKeyDown={(e) => {
          // 키보드: 위 화살표로 메뉴 열기
          if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setHover(current); }
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
