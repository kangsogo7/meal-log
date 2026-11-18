// 왼쪽으로 밀어서 삭제: 조금 밀면 삭제 버튼이 보이고, 끝까지 밀면 바로 삭제
import { useRef, useState } from "react";

const BTN = 84; // 삭제 버튼 너비

export default function SwipeRow({ onDelete, label = "삭제", children }: { onDelete: () => void; label?: string; children: React.ReactNode }) {
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const start = useRef<{ px: number; py: number; x: number; dir: "h" | "v" | null } | null>(null);
  const moved = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const down = (e: React.PointerEvent) => {
    start.current = { px: e.clientX, py: e.clientY, x, dir: null };
    moved.current = false;
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    if (!s.dir) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (s.dir === "h") {
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 이미 끝난 터치 */ }
        setDrag(true);
      }
    }
    if (s.dir !== "h") return;
    moved.current = true;
    const w = box.current?.offsetWidth || 320;
    setX(Math.min(0, Math.max(-w, s.x + dx)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.dir !== "h") return;
    setDrag(false);
    const w = box.current?.offsetWidth || 320;
    if (x < -w * 0.55) {
      setX(-w);
      setTimeout(onDelete, 160);
    } else setX(x < -BTN / 2 ? -BTN : 0);
  };

  return (
    <div className="swipe" ref={box}>
      <button className="swipe-del" onClick={onDelete} tabIndex={x ? 0 : -1} style={{ width: Math.max(BTN, -x) }}>{label}</button>
      <div
        className={`swipe-body ${drag ? "drag" : ""}`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // 밀던 중이거나 버튼이 열려 있으면 누르기 대신 닫기
        onClickCapture={(e) => {
          if (moved.current || x) {
            e.stopPropagation();
            e.preventDefault();
            if (!moved.current) setX(0);
          }
          moved.current = false;
        }}
      >
        {children}
      </div>
    </div>
  );
}
