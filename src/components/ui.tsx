import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addDays, formatDate, todayStr, type Nutrients } from "../db";
import { kcalFromMacros } from "../nutrition";

let openLayers = 0;
let lockedY = 0;

/**
 * 창(시트·전체 화면)을 body 바로 아래에 그림.
 * 다른 창 안에서 열어도 그 창의 스크롤 영역에 갇히지 않고(아이폰), 나중에 연 창이 항상 위에 옴.
 * 마지막 창이 닫힐 때까지 뒤 화면을 지금 위치에 고정 (키보드가 떠도 뒤 화면이 밀려 내려가지 않게).
 */
function useLayer() {
  const [z] = useState(() => 20 + openLayers * 10);
  useEffect(() => {
    if (openLayers++ === 0) {
      lockedY = window.scrollY;
      document.body.style.top = `-${lockedY}px`;
      document.body.classList.add("no-scroll");
    }
    return () => {
      if (--openLayers === 0) {
        document.body.classList.remove("no-scroll");
        document.body.style.top = "";
        window.scrollTo(0, lockedY);
      }
    };
  }, []);
  return z;
}

/** tall: 내용(검색 결과 등)이 바뀌어도 창 높이가 출렁이지 않게 높이 고정 */
export function Sheet({ title, onClose, children, footer, tall }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  const z = useLayer();
  const [scrolled, setScrolled] = useState(false);
  return createPortal(
    <div className="sheet-backdrop" style={{ zIndex: z }} onClick={onClose}>
      <div className={`sheet ${tall ? "tall" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className={`sheet-head ${scrolled ? "scrolled" : ""}`}>
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="sheet-body" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** 화면 전체를 덮는 페이지 (음식 편집, 내 폴더 등) */
export function Screen({ title, left, right, footer, children }: { title: ReactNode; left: ReactNode; right?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const z = useLayer();
  return createPortal(
    <div className="screen-page" style={{ zIndex: z }} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
      <header className="screen-head">
        <div>{left}</div>
        <h2>{title}</h2>
        <div className="screen-right">{right}</div>
      </header>
      <div className="screen-body">{children}</div>
      {footer && <footer className="screen-foot">{footer}</footer>}
    </div>,
    document.body,
  );
}

/** 펼친 내용이 창 아래로 잘려 있으면, 그 창 안에서만 보일 만큼 부드럽게 올림 (이미 다 보이면 그대로) */
export function revealInSheet(el: Element | null | undefined) {
  const box = el?.closest(".sheet-body, .screen-body");
  if (!el || !box) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const pad = 12;
  // 아래가 잘린 만큼 올리되, 카드가 창보다 크면 카드 위쪽이 보이는 데까지만
  const d = Math.min(r.bottom - b.bottom + pad, r.top - b.top - pad);
  if (d > 0) box.scrollBy({ top: d, behavior: "smooth" });
}

/** ◀ 날짜 오늘 ▶ (글자 길이와 상관없이 화살표 위치 고정) */
export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const isToday = date === todayStr();
  return (
    <header className="page-head date-nav">
      <button className="ghost" onClick={() => onChange(addDays(date, -1))} aria-label="이전 날">◀</button>
      <span aria-hidden />
      <label className="date-label">
        {formatDate(date)}
        <input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </label>
      <button className={`chip today-slot ${isToday ? "" : "show"}`} onClick={() => onChange(todayStr())} tabIndex={isToday ? -1 : 0}>오늘</button>
      <button className="ghost" onClick={() => onChange(addDays(date, 1))} aria-label="다음 날">▶</button>
    </header>
  );
}

export const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 12H5M11 6l-6 6 6 6" />
  </svg>
);

/**
 * 숫자 입력 (빈칸 허용).
 * 입력 중인 글자는 따로 들고 있어서, 칸을 비워도 부모가 0으로 저장한 값이 "0"으로 되살아나지 않음.
 * 칸을 누르면 전체 선택돼서 바로 새 숫자를 칠 수 있음.
 */
export function NumInput({
  value, onChange, placeholder, step = "any", className, decimals,
}: {
  value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: string; className?: string;
  /** 소수점 아래 최대 자릿수 (예: 1 → 150.5까지) */
  decimals?: number;
}) {
  const show = (v: number | null | undefined) => (v == null ? "" : String(Math.round(v * 10) / 10));
  const [text, setText] = useState(show(value));
  // 바깥에서 값이 바뀐 경우(양 조절 등)에만 화면 글자를 맞춤
  useEffect(() => {
    if (Math.abs(Number(text || 0) - (value ?? 0)) > 0.05) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={className}
      type="text"
      inputMode={step === "1" ? "numeric" : "decimal"}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        // 숫자와 소수점 하나만 허용, 앞에 붙은 0 제거 ("065" → "65", "0.5"는 유지)
        let t = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^0+(?=\d)/, "");
        if (decimals === 0) t = t.replace(/\..*$/, "");
        else if (decimals != null) t = t.replace(new RegExp(`(\\.\\d{${decimals}})\\d+$`), "$1");
        if (t.startsWith(".")) t = "0" + t;
        setText(t);
        onChange(t === "" ? null : Number(t));
      }}
    />
  );
}

export function NutrientLine({ n }: { n: Nutrients }) {
  return (
    <span className="nline">
      <b>{Math.round(n.kcal)} kcal</b> · 탄 {fmt(n.carb)} · 단 {fmt(n.protein)} · 지 {fmt(n.fat)}
      {n.sodium ? ` · 나 ${Math.round(n.sodium).toLocaleString()}mg` : ""}
    </span>
  );
}
const fmt = (v: number) => `${Math.round(v * 10) / 10}g`;

/** 목표 대비 진행 막대 */
export function Progress({ label, value, target, unit, className }: { label: string; value: number; target?: number | null; unit: string; className?: string }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = !!target && value > target * 1.05;
  return (
    <div className={`progress-row ${className ?? ""}`}>
      <div className="progress-label">
        <span>{label}</span>
        <span className={over ? "over" : ""}>
          <b>{Math.round(value)}</b>
          {target ? ` / ${Math.round(target)}` : ""} {unit}
        </span>
      </div>
      <div className="progress"><div className={over ? "over" : ""} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** 탄단지·나트륨 편집. 칼로리는 탄단지를 고치면 자동으로 다시 계산(4/4/9)되고, 직접 고칠 수도 있음 */
export function NutrientEditor({ n, onChange }: { n: Nutrients; onChange: (n: Nutrients) => void }) {
  const field = (key: "carb" | "protein" | "fat", label: string) => (
    <label className="nfield">
      <span>{label} (g)</span>
      <NumInput
        value={n[key]}
        onChange={(v) => {
          const next = { ...n, [key]: v ?? 0 };
          onChange({ ...next, kcal: kcalFromMacros(next.carb, next.protein, next.fat) });
        }}
      />
    </label>
  );
  return (
    <div className="ngrid three">
      <label className="nfield">
        <span>칼로리</span>
        <NumInput value={Math.round(n.kcal)} onChange={(v) => onChange({ ...n, kcal: v ?? 0 })} step="1" />
      </label>
      {field("carb", "탄수화물")}
      {field("protein", "단백질")}
      {field("fat", "지방")}
      <label className="nfield">
        <span>나트륨 (mg)</span>
        <NumInput value={n.sodium ?? 0} onChange={(v) => onChange({ ...n, sodium: v ?? 0 })} step="1" />
      </label>
    </div>
  );
}

/** − ×1.5 + : 기본 제공량의 배수를 0.5씩 조절 (최소 0.5) */
export function Stepper({ value, onChange }: { value: number; onChange: (k: number) => void }) {
  // 직접 g을 고쳐서 1.3배처럼 애매한 값이면 가까운 0.5 단위로 이동
  const up = Math.floor(value * 2 + 1e-6) / 2 + 0.5;
  const down = Math.max(0.5, Math.ceil(value * 2 - 1e-6) / 2 - 0.5);
  return (
    <div className="stepper">
      <button onClick={() => onChange(down)} disabled={value <= 0.5} aria-label="0.5배 줄이기">−</button>
      {/* 배수 직접 입력 (소수점 첫째 자리까지) */}
      <label className="stepper-value">
        ×
        <NumInput
          value={Math.round(value * 10) / 10}
          onChange={(v) => v != null && v > 0 && onChange(v)}
          decimals={1}
          className="stepper-input"
        />
      </label>
      <button onClick={() => onChange(up)} aria-label="0.5배 늘리기">+</button>
    </div>
  );
}

/** 왼쪽으로 밀면 삭제 버튼이 나오는 줄 */
export function SwipeRow({ children, onTap, onDelete }: { children: ReactNode; onTap: () => void; onDelete: () => void }) {
  const OPEN = -84;
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ px: number; py: number; x: number; horizontal: boolean | null } | null>(null);
  const moved = useRef(false);

  return (
    <div className="swipe-row">
      <button className="swipe-delete" onClick={onDelete} tabIndex={x === OPEN ? 0 : -1}>삭제</button>
      <div
        className="swipe-content"
        style={{ transform: `translateX(${x}px)`, transition: dragging ? "none" : "transform 0.2s" }}
        onPointerDown={(e) => {
          start.current = { px: e.clientX, py: e.clientY, x, horizontal: null };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.px, dy = e.clientY - s.py;
          if (s.horizontal === null && Math.abs(dx) + Math.abs(dy) > 6) s.horizontal = Math.abs(dx) > Math.abs(dy);
          if (!s.horizontal) return;
          moved.current = true;
          setDragging(true);
          setX(Math.max(OPEN - 20, Math.min(0, s.x + dx)));
        }}
        onPointerUp={() => {
          if (start.current?.horizontal) setX((v) => (v < OPEN / 2 ? OPEN : 0));
          start.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setX((v) => (v < OPEN / 2 ? OPEN : 0));
        }}
        onClick={() => {
          if (moved.current) return;
          if (x !== 0) setX(0);
          else onTap();
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 잠깐 보였다 사라지는 안내 (어느 화면에서든 호출) */
export function flash(message: string) {
  document.querySelectorAll(".toast.flash").forEach((el) => el.remove());
  const el = document.createElement("div");
  el.className = "toast flash";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}
