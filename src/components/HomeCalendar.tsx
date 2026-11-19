// 홈 달력: 평소엔 한 주, 아래 손잡이를 누르면 한 달로 펼침.
// ‹ › 또는 좌우로 밀어서 주 단위면 저번 주·다음 주, 달 단위면 저번 달·다음 달로
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, todayStr } from "../db";
import { weekStartOf } from "../weekly";

const DOWS = ["월", "화", "수", "목", "금", "토", "일"];

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-11" 달의 칸 (앞뒤는 그 주를 채우는 이웃 달 날짜) */
function monthCells(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const first = `${y}-${pad(m)}-01`;
  const last = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
  const start = weekStartOf(first);
  const cells: string[] = [];
  for (let d = start; d <= last || cells.length % 7; d = addDays(d, 1)) cells.push(d);
  return cells;
}
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(y, m - 1 + n, 1);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
};

export default function HomeCalendar({ date, onSelect }: { date: string; onSelect: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState(() => weekStartOf(date)); // 보고 있는 주의 월요일
  const [month, setMonth] = useState(() => date.slice(0, 7)); // 보고 있는 달
  // 날짜를 다른 곳에서 바꾸면 그 날짜가 있는 주·달로
  useEffect(() => {
    setWeek(weekStartOf(date));
    setMonth(date.slice(0, 7));
  }, [date]);

  const cells = open ? monthCells(month) : Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const from = cells[0];
  const to = cells[cells.length - 1];
  const done = useLiveQuery(async () => new Set((await db.entries.where("date").between(from, to, true, true).toArray()).map((e) => e.date)), [from, to], new Set<string>());
  const today = todayStr();

  const move = (n: number) => (open ? setMonth((m) => shiftMonth(m, n)) : setWeek((w) => addDays(w, 7 * n)));
  const toggle = () => {
    // 펼칠 땐 보고 있던 주의 달, 접을 땐 고른 날짜의 주(그 달에 있으면) 또는 그 달 첫 주
    if (open) setWeek(date.slice(0, 7) === month ? weekStartOf(date) : weekStartOf(`${month}-01`));
    else setMonth(addDays(week, 3).slice(0, 7));
    setOpen(!open);
  };

  // 좌우로 밀어서 이동
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [m1, d1] = [Number(from.slice(5, 7)), Number(from.slice(8))];
  const [m2, d2] = [Number(to.slice(5, 7)), Number(to.slice(8))];
  const label = open ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월` : `${m1}/${d1} ~ ${m1 === m2 ? "" : `${m2}/`}${d2}`;

  return (
    <div
      className={`home-cal ${open ? "open" : ""}`}
      onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
      }}
    >
      <div className="hc-nav">
        <button onClick={() => move(-1)} aria-label={open ? "저번 달" : "저번 주"}>‹</button>
        <span>{label}</span>
        <button onClick={() => move(1)} aria-label={open ? "다음 달" : "다음 주"}>›</button>
      </div>
      <div className="home-week">
        {DOWS.map((d) => <span key={d} className="hw-dow">{d}</span>)}
        {cells.map((d) => (
          <button
            key={d}
            className={`hw-day ${d === date ? "on" : ""} ${d > today ? "future" : ""} ${open && d.slice(0, 7) !== month ? "other" : ""}`}
            onClick={() => onSelect(d)}
            aria-label={d}
          >
            <b>{Number(d.slice(8))}</b>
            <i className={done.has(d) ? "dot" : ""} aria-hidden />
          </button>
        ))}
      </div>
      <button className="hc-handle" onClick={toggle} aria-label={open ? "한 주로 접기" : "한 달로 펼치기"} aria-expanded={open}><i /></button>
    </div>
  );
}
