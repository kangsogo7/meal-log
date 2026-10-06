import { useEffect, useState, type ReactNode } from "react";
import type { Nutrients } from "../db";
import { kcalFromMacros } from "../nutrition";

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    document.body.classList.add("no-scroll");
    return () => document.body.classList.remove("no-scroll");
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * 숫자 입력 (빈칸 허용).
 * 입력 중인 글자는 따로 들고 있어서, 칸을 비워도 부모가 0으로 저장한 값이 "0"으로 되살아나지 않음.
 * 칸을 누르면 전체 선택돼서 바로 새 숫자를 칠 수 있음.
 */
export function NumInput({
  value, onChange, placeholder, step = "any", className,
}: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: string; className?: string }) {
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

/** 탄단지 편집. 칼로리는 탄단지를 고치면 자동으로 다시 계산(4/4/9) */
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
    <div className="ngrid">
      <div className="nfield">
        <span>칼로리</span>
        <output className="kcal-auto">{Math.round(n.kcal).toLocaleString()}</output>
      </div>
      {field("carb", "탄수화물")}
      {field("protein", "단백질")}
      {field("fat", "지방")}
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}
