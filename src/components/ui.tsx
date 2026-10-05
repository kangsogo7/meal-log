import { useEffect, type ReactNode } from "react";
import type { Nutrients } from "../db";

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

/** 숫자 입력 (빈칸 허용) */
export function NumInput({
  value, onChange, placeholder, step = "any", className,
}: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: string; className?: string }) {
  return (
    <input
      className={className}
      type="number"
      inputMode="decimal"
      step={step}
      min={0}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
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

/** 칼로리, 탄단지 4칸 편집 */
export function NutrientEditor({ n, onChange }: { n: Nutrients; onChange: (n: Nutrients) => void }) {
  const field = (key: keyof Nutrients, label: string, unit: string) => (
    <label className="nfield">
      <span>{label}</span>
      <div className="with-unit">
        <NumInput value={n[key] === undefined ? null : Math.round((n[key] as number) * 10) / 10} onChange={(v) => onChange({ ...n, [key]: v ?? 0 })} />
        <em>{unit}</em>
      </div>
    </label>
  );
  return (
    <div className="ngrid">
      {field("kcal", "칼로리", "kcal")}
      {field("carb", "탄수화물", "g")}
      {field("protein", "단백질", "g")}
      {field("fat", "지방", "g")}
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}
