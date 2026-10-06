import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, formatDate, MEALS, sumNutrients, todayStr, type Entry, type Meal } from "../db";
import { useTargets } from "../hooks";
import { NutrientLine, Progress } from "../components/ui";
import { WeekChart } from "../components/charts";
import { SODIUM_LIMIT } from "../nutrition";
import AddSheet from "./AddSheet";
import EntrySheet from "./EntrySheet";

export default function Today({ onGoToGoals }: { onGoToGoals: () => void }) {
  const [date, setDate] = useState(todayStr());
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const { target } = useTargets();

  const weekStart = addDays(date, -6);
  const weekEntries = useLiveQuery(() => db.entries.where("date").between(weekStart, date, true, true).toArray(), [weekStart, date], []);
  const entries = weekEntries.filter((e) => e.date === date).sort((a, b) => a.createdAt - b.createdAt);
  const total = sumNutrients(entries.map((e) => e.total));

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekKcal = days.map((d) => sumNutrients(weekEntries.filter((e) => e.date === d).map((e) => e.total)).kcal);
  const isToday = date === todayStr();

  return (
    <>
      <header className="page-head date-nav">
        <button className="ghost" onClick={() => setDate(addDays(date, -1))} aria-label="이전 날">◀</button>
        <label className="date-label">
          {isToday ? "오늘 · " : ""}{formatDate(date)}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button className="ghost" onClick={() => setDate(addDays(date, 1))} aria-label="다음 날">▶</button>
        {!isToday && <button className="chip" onClick={() => setDate(todayStr())}>오늘</button>}
      </header>

      <section className="card">
        <Progress label="칼로리" value={total.kcal} target={target?.kcal} unit="kcal" className="big" />
        <div className="macro-grid">
          <Progress label="탄수화물" value={total.carb} target={target?.carb} unit="g" className="carb" />
          <Progress label="단백질" value={total.protein} target={target?.protein} unit="g" className="protein" />
          <Progress label="지방" value={total.fat} target={target?.fat} unit="g" className="fat" />
        </div>
        <Progress label="나트륨 (권장 상한)" value={total.sodium ?? 0} target={target?.sodium ?? SODIUM_LIMIT} unit="mg" className="sodium" />
        {target ? (
          <p className="muted small remain">
            {total.kcal <= target.kcal
              ? `${(target.kcal - total.kcal).toLocaleString()} kcal 더 먹을 수 있어요`
              : `목표보다 ${(total.kcal - target.kcal).toLocaleString()} kcal 더 먹었어요`}
          </p>
        ) : (
          <button className="link small" onClick={onGoToGoals}>내 정보를 입력하면 목표 영양성분을 추천해 드려요 →</button>
        )}
      </section>

      {MEALS.map((m) => {
        const list = entries.filter((e) => e.meal === m.key);
        const sub = sumNutrients(list.map((e) => e.total));
        return (
          <section className="card meal" key={m.key}>
            <div className="meal-head">
              <h2>
                {m.icon} {m.label}
                {list.length > 0 && <span className="muted meal-kcal">{sub.kcal} kcal</span>}
              </h2>
              <button className="chip primary" onClick={() => setAdding(m.key)}>+ 기록</button>
            </div>
            {list.length > 0 && (
              <ul className="entries">
                {list.map((e) => (
                  <li key={e.id} onClick={() => setEditing(e)}>
                    <div className="entry-title">
                      <span className={`tag ${e.kind}`}>{e.kind === "out" ? "외식" : e.kind === "home" ? "집밥" : "직접"}</span>
                      {e.place ? `${e.place} · ` : ""}{e.title}
                    </div>
                    <NutrientLine n={e.total} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <section className="card">
        <h2>최근 7일 칼로리</h2>
        <WeekChart days={days} values={weekKcal} goal={target?.kcal ?? null} selected={date} onSelect={setDate} />
      </section>

      {adding && <AddSheet date={date} meal={adding} onClose={() => setAdding(null)} />}
      {editing && <EntrySheet entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
