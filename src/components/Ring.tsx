// 홈의 작은 원형 그래프. steps를 주면 칸(잔·개)으로 나눠서 채움
const R = 17;
const C = 2 * Math.PI * R;

export default function Ring({ label, value, max, steps, over, onClick }: {
  label: string;
  value: number;
  max: number;
  /** 칸 수 (물 잔·영양제 개수). 없으면 이어진 원 */
  steps?: number;
  over?: boolean;
  onClick?: () => void;
}) {
  const p = max > 0 ? Math.min(1, value / max) : 0;
  const n = steps && steps <= 16 ? steps : 0;
  const gap = n > 1 ? 3 : 0;
  const seg = n ? C / n : C;
  const arcs = n
    ? Array.from({ length: n }, (_, i) => ({ on: i < Math.min(n, value), off: i * seg }))
    : null;
  return (
    <button className="ring" onClick={onClick} disabled={!onClick} aria-label={`${label} ${Math.round(value)} / ${Math.round(max)}`}>
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
        <g transform="rotate(-90 22 22)">
          {arcs ? (
            arcs.map((a, i) => (
              <circle key={i} cx="22" cy="22" r={R} className={a.on ? "ring-on" : "ring-track"} strokeDasharray={`${seg - gap} ${C - seg + gap}`} strokeDashoffset={-a.off} />
            ))
          ) : (
            <>
              <circle cx="22" cy="22" r={R} className="ring-track" />
              {p > 0 && <circle cx="22" cy="22" r={R} className={`ring-on ${over ? "over" : ""}`} strokeDasharray={`${p * C} ${C}`} />}
            </>
          )}
        </g>
      </svg>
      <span>{label}</span>
    </button>
  );
}
