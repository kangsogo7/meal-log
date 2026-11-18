// 사진 영역 고르기 (A안): 비율(1:1 · 4:5 · 4:3 · 원본)을 고르고, 사진을 끌어서 옮기고 두 손가락으로 크기 조절.
// 바깥은 어둡게 덮고 3등분 격자 + 굵은 모서리. exportCrop()으로 고른 영역을 JPEG로
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export type Ratio = "1:1" | "4:5" | "4:3" | "orig";
const RATIOS: { key: Ratio; label: string; w: number; h: number; dashed?: boolean }[] = [
  { key: "1:1", label: "1:1", w: 16, h: 16 },
  { key: "4:5", label: "4:5", w: 14, h: 18 },
  { key: "4:3", label: "4:3", w: 18, h: 14 },
  { key: "orig", label: "원본", w: 18, h: 12, dashed: true },
];
const PAD = 12;
const OUT_MAX = 1440;

export interface CropHandle { exportCrop: () => Promise<Blob | null> }
interface View { s: number; x: number; y: number }

/** 이미지를 90도씩 돌린 새 이미지 */
async function rotated(img: HTMLImageElement, quarter: number): Promise<HTMLImageElement> {
  const c = document.createElement("canvas");
  const swap = quarter % 2 === 1;
  c.width = swap ? img.naturalHeight : img.naturalWidth;
  c.height = swap ? img.naturalWidth : img.naturalHeight;
  const g = c.getContext("2d")!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((quarter * Math.PI) / 2);
  g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const out = new Image();
  out.src = c.toDataURL("image/jpeg", 0.92);
  await out.decode();
  return out;
}

const CropEditor = forwardRef<CropHandle, { src: string | null; onReady?: (ready: boolean) => void }>(function CropEditor({ src, onReady }, ref) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [ratio, setRatio] = useState<Ratio>("1:1");
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // 무대 크기
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 사진 불러오기
  useEffect(() => {
    setImg(null);
    onReady?.(false);
    if (!src) return;
    let on = true;
    const i = new Image();
    i.src = src;
    i.decode().then(() => on && setImg(i)).catch(() => {});
    return () => { on = false; };
  }, [src]);

  // 자르는 칸 (무대 안 가운데)
  const box = (() => {
    if (!size.w || !img) return { x: 0, y: 0, w: 0, h: 0 };
    const r = ratio === "orig" ? img.naturalWidth / img.naturalHeight : ratio === "4:5" ? 4 / 5 : ratio === "4:3" ? 4 / 3 : 1;
    const aw = size.w - PAD * 2;
    const ah = size.h - PAD * 2;
    const w = Math.min(aw, ah * r);
    const h = w / r;
    return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h };
  })();

  const minScale = img && box.w ? Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight) : 1;

  /** 사진이 자르는 칸을 항상 덮게 */
  const clamp = useCallback((v: View): View => {
    if (!img) return v;
    const s = Math.min(Math.max(v.s, minScale), minScale * 6);
    const iw = img.naturalWidth * s;
    const ih = img.naturalHeight * s;
    const x = Math.min(box.x, Math.max(box.x + box.w - iw, v.x));
    const y = Math.min(box.y, Math.max(box.y + box.h - ih, v.y));
    return { s, x, y };
  }, [img, minScale, box.x, box.y, box.w, box.h]);

  // 사진·비율·크기가 바뀌면 가운데로 꽉 차게
  useEffect(() => {
    if (!img || !box.w) return;
    const s = minScale;
    setView({ s, x: box.x + (box.w - img.naturalWidth * s) / 2, y: box.y + (box.h - img.naturalHeight * s) / 2 });
    onReady?.(true);
  }, [img, ratio, size.w, size.h]);

  const reset = () => {
    if (!img) return;
    setView({ s: minScale, x: box.x + (box.w - img.naturalWidth * minScale) / 2, y: box.y + (box.h - img.naturalHeight * minScale) / 2 });
  };

  const rotate = async () => {
    if (!img) return;
    setImg(await rotated(img, 3));
  };

  // 끌기·두 손가락 확대
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const move = (e: React.PointerEvent) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const rect = stage.current!.getBoundingClientRect();
    if (ps.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
      return;
    }
    const others = [...ps.entries()].filter(([id]) => id !== e.pointerId);
    const o = others[0][1];
    const before = Math.hypot(prev.x - o.x, prev.y - o.y);
    const after = Math.hypot(e.clientX - o.x, e.clientY - o.y);
    ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!before) return;
    const mx = (e.clientX + o.x) / 2 - rect.left;
    const my = (e.clientY + o.y) / 2 - rect.top;
    setView((v) => {
      const s = Math.min(Math.max(v.s * (after / before), minScale), minScale * 6);
      const k = s / v.s;
      return clamp({ s, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k });
    });
  };
  const up = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); };

  useImperativeHandle(ref, () => ({
    exportCrop: async () => {
      if (!img || !box.w) return null;
      const sx = (box.x - view.x) / view.s;
      const sy = (box.y - view.y) / view.s;
      const sw = box.w / view.s;
      const sh = box.h / view.s;
      const k = Math.min(1, OUT_MAX / Math.max(sw, sh));
      const c = document.createElement("canvas");
      c.width = Math.round(sw * k);
      c.height = Math.round(sh * k);
      c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.88));
    },
  }), [img, box.x, box.y, box.w, box.h, view]);

  return (
    <div className="crop">
      <div className="crop-stage" ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {img && (
          <img src={img.src} alt="" draggable={false} style={{ left: view.x, top: view.y, width: img.naturalWidth * view.s, height: img.naturalHeight * view.s }} />
        )}
        {img && box.w > 0 && (
          <>
            <i className="crop-shade" style={{ left: 0, top: 0, right: 0, height: box.y }} />
            <i className="crop-shade" style={{ left: 0, bottom: 0, right: 0, height: size.h - box.y - box.h }} />
            <i className="crop-shade" style={{ left: 0, top: box.y, width: box.x, height: box.h }} />
            <i className="crop-shade" style={{ right: 0, top: box.y, width: size.w - box.x - box.w, height: box.h }} />
            <div className="crop-frame" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
              <i className="v1" /><i className="v2" /><i className="h1" /><i className="h2" />
              <b className="tl" /><b className="tr" /><b className="bl" /><b className="br" />
            </div>
          </>
        )}
        {!img && <span className="crop-wait">{src ? "사진 여는 중..." : "아래에서 사진을 골라 주세요"}</span>}
      </div>
      <div className="crop-tools">
        <div className="crop-ratios" role="radiogroup" aria-label="비율">
          {RATIOS.map((r) => (
            <button key={r.key} role="radio" aria-checked={ratio === r.key} className={ratio === r.key ? "on" : ""} onClick={() => setRatio(r.key)}>
              <i style={{ width: r.w, height: r.h, borderStyle: r.dashed ? "dashed" : "solid" }} aria-hidden />
              {r.label}
            </button>
          ))}
        </div>
        <button className="crop-icon" onClick={rotate} disabled={!img} aria-label="왼쪽으로 돌리기">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8V3M4 3h5M4 3l3.5 3.5A8 8 0 1 1 4 12" /></svg>
        </button>
        <button className="crop-icon" onClick={reset} disabled={!img} aria-label="처음 위치로">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 4h6M4 4v6M20 20h-6M20 20v-6M4 20h6M4 20v-6M20 4h-6M20 4v6" /></svg>
        </button>
      </div>
    </div>
  );
});

export default CropEditor;
