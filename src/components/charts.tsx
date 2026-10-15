import { useState, type ReactNode } from "react";

/** 최근 7일 막대 + 목표선. 막대를 누르면 그 날짜로 이동 */
/** 항목 색: 홈 화면의 탄수화물(노랑)·단백질(초록)·지방(분홍) 색 */
export type Tone = "carb" | "protein" | "fat";

export function WeekChart({
  days, values, goal, selected, onSelect, label = "최근 7일 섭취 칼로리", unit = "kcal", showAll = false, tone,
}: {
  days: string[]; values: number[]; goal: number | null; selected: string; onSelect: (d: string) => void; label?: string; unit?: string;
  /** 모든 막대 위에 값 표시 (기본은 고른 날만) */
  showAll?: boolean;
  /** 막대 색 (없으면 기본 강조색) */
  tone?: Tone;
}) {
  const W = 340, H = 150, top = 18, bottom = 24, gap = 10;
  const plotH = H - top - bottom;
  const max = Math.max(goal ? goal * 1.2 : 0, ...values, 1);
  const bw = (W - gap * (days.length - 1)) / days.length;
  const y = (v: number) => top + plotH - (v / max) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
      <line x1={0} x2={W} y1={top + plotH} y2={top + plotH} className="axis" />
      {days.map((d, i) => {
        const v = values[i];
        const x = i * (bw + gap);
        const h = Math.max(v ? 3 : 0, top + plotH - y(v));
        const over = !!goal && v > goal * 1.05;
        const [, m, day] = d.split("-").map(Number);
        const sel = d === selected;
        return (
          <g key={d} onClick={() => onSelect(d)} className="bar-g">
            <title>{`${m}/${day}: ${v.toLocaleString()} ${unit}`}</title>
            <rect x={x} y={top} width={bw} height={plotH + bottom} fill="transparent" />
            <path
              d={roundedTop(x + bw * 0.15, top + plotH - h, bw * 0.7, h, Math.min(4, h))}
              className={over ? "bar over" : `bar${tone ? " tone-" + tone : ""}`}
              opacity={sel ? 1 : 0.55}
            />
            {(sel || showAll) && v > 0 && (
              <text x={x + bw / 2} y={top + plotH - h - 5} textAnchor="middle" className={sel ? "val" : "val dim"}>{v.toLocaleString()}</text>
            )}
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" className={sel ? "tick sel" : "tick"}>{`${m}/${day}`}</text>
          </g>
        );
      })}
      {goal && (
        <>
          <line x1={0} x2={W} y1={y(goal)} y2={y(goal)} className="goal" />
          <text x={W} y={y(goal) - 4} textAnchor="end" className="tick">목표 {goal}</text>
        </>
      )}
    </svg>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** 원형 진행 그래프 (가운데 내용은 children). 목표를 넘으면 --over 색 */
export function Ring({ value, max, size = 132, stroke = 13, label, children }: { value: number; max: number; size?: number; stroke?: number; label: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const ratio = max > 0 ? value / max : 0;
  const over = ratio > 1.05;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ring-track" strokeWidth={stroke} />
        {ratio > 0 && <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" className={over ? "ring-bar over" : "ring-bar"} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${Math.min(1, ratio) * len} ${len}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

/** 체중 추이 꺾은선. 점을 누르면 값 표시 */
export function WeightChart({ points }: { points: { date: string; weight: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return null;
  // 오른쪽에 kg 눈금 (1kg 간격, 범위가 넓으면 2·5kg)
  const W = 340, H = 170, padX = 14, axisW = 40, top = 22, bottom = 22;
  const ws = points.map((p) => p.weight);
  const span = Math.max(...ws) - Math.min(...ws) + 1;
  const step = span <= 6 ? 1 : span <= 12 ? 2 : 5;
  const lo = Math.floor((Math.min(...ws) - 0.5) / step) * step, hi = Math.ceil((Math.max(...ws) + 0.5) / step) * step;
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const t0 = +new Date(points[0].date), t1 = +new Date(points[points.length - 1].date);
  const x = (d: string) => padX + ((+new Date(d) - t0) / Math.max(1, t1 - t0)) * (W - axisW - padX * 2);
  const y = (w: number) => top + (1 - (w - lo) / (hi - lo)) * (H - top - bottom);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.weight)}`).join(" ");
  const a = active ?? points.length - 1;
  const ap = points[a];
  const label = (d: string) => d.slice(5).replace("-", "/");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="체중 추이">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={W - axisW + 4} y1={y(t)} y2={y(t)} className="grid" />
          <text x={W - 2} y={y(t) + 4} textAnchor="end" className="tick">{t.toFixed(1)}</text>
        </g>
      ))}
      <text x={W - 2} y={top - 10} textAnchor="end" className="tick">kg</text>
      <path d={path} className="line" fill="none" />
      {points.map((p, i) => (
        <g key={i} onClick={() => setActive(i)}>
          <circle cx={x(p.date)} cy={y(p.weight)} r={14} fill="transparent" />
          <circle cx={x(p.date)} cy={y(p.weight)} r={i === a ? 5 : 3.5} className="dot" />
        </g>
      ))}
      <text x={Math.min(W - axisW - 30, Math.max(30, x(ap.date)))} y={y(ap.weight) - 10} textAnchor="middle" className="val">
        {ap.weight}kg
      </text>
      <text x={padX} y={H - 5} className="tick">{label(points[0].date)}</text>
      <text x={W - axisW - padX} y={H - 5} textAnchor="end" className="tick">{label(points[points.length - 1].date)}</text>
    </svg>
  );
}
