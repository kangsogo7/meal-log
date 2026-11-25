// 길게 누르면 "사진 저장" 버튼이 뜨는 사진 (기록 화면). 저장은 앨범에 그대로
import { useEffect, useRef, useState } from "react";
import { savePhoto } from "../photoLibrary";
import { flash } from "./ui";

const HOLD_MS = 500;

export default function SavablePhoto({ src, alt, name }: { src: string; alt: string; name?: string }) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  useEffect(() => cancel, []);

  // 바깥을 누르면 닫기
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".photo-save-btn")) setMenu(false);
    };
    const t = setTimeout(() => document.addEventListener("pointerdown", close), 0);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", close); };
  }, [menu]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await (await fetch(src)).blob();
      const r = await savePhoto(blob, name);
      if (r === "saved") flash("앨범에 저장했어요");
      setMenu(false);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        flash(`저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}`, 4000);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="photo-save"
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY };
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { start.current = null; setMenu(true); navigator.vibrate?.(10); }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img src={src} alt={alt} draggable={false} />
      {menu && (
        <button className="photo-save-btn" onClick={save} disabled={busy}>
          {busy ? "저장 중…" : "사진 저장"}
        </button>
      )}
    </div>
  );
}
