import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, formatDate, KIND_LABEL, MEALS, sumNutrients, todayStr, type Entry, type Meal } from "../db";
import { useProfile, useTargets } from "../hooks";
import { NutrientLine, Progress } from "../components/ui";
import { WeekChart } from "../components/charts";
import { evaluateMeal, GOALS, GRADE_EMOJI, MEAL_SHARE, SODIUM_LIMIT } from "../nutrition";
import AddSheet from "./AddSheet";
import { entryDraft, FavStar } from "../favorites";
import EntrySheet from "./EntrySheet";

/** 끼니의 기록들을 식사 세트로 저장 (즐겨찾기 탭에서 한 번에 기록) */
async function saveAsSet(mealLabel: string, list: Entry[]) {
  const name = prompt("식사 세트 이름", `${mealLabel} 세트`)?.trim();
  if (!name) return;
  try {
    await db.sets.add({
      name,
      entries: list.map((e) => ({ kind: e.kind, title: e.title, place: e.place, items: e.items })),
      total: sumNutrients(list.map((e) => e.total)),
      updatedAt: Date.now(),
    });
    alert(`"${name}" 세트를 저장했어요. 기록할 때 즐겨찾기 탭에서 한 번에 넣을 수 있어요.`);
  } catch (err) {
    alert(`저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export default function Today({ onGoToGoals }: { onGoToGoals: () => void }) {
  const [date, setDate] = useState(todayStr());
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [openEval, setOpenEval] = useState<Meal | null>(null);
  const { target } = useTargets();
  const profile = useProfile();

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
        <span aria-hidden />
        <label className="date-label">
          {formatDate(date)}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button className={`chip today-slot ${isToday ? "" : "show"}`} onClick={() => setDate(todayStr())} tabIndex={isToday ? -1 : 0}>오늘</button>
        <button className="ghost" onClick={() => setDate(addDays(date, 1))} aria-label="다음 날">▶</button>
      </header>

      <section className="card">
        <Progress label="칼로리" value={total.kcal} target={target?.kcal} unit="kcal" className="big" />
        <div className="macro-grid">
          <Progress label="탄수화물" value={total.carb} target={target?.carb} unit="g" className="carb" />
          <Progress label="단백질" value={total.protein} target={target?.protein} unit="g" className="protein" />
          <Progress label="지방" value={total.fat} target={target?.fat} unit="g" className="fat" />
        </div>
        <Progress label="나트륨" value={total.sodium ?? 0} target={target?.sodium ?? SODIUM_LIMIT} unit="mg" className="sodium" />
        {target ? (
          <p className="muted small remain">
            {total.kcal <= target.kcal
              ? `${(target.kcal - total.kcal).toLocaleString()} kcal 더 먹을 수 있어요`
              : `목표보다 ${(total.kcal - target.kcal).toLocaleString()} kcal 더 먹었어요`}
          </p>
        ) : (
          <button className="link small" onClick={onGoToGoals}>목표 설정하기 →</button>
        )}
      </section>

      {MEALS.map((m) => {
        const list = entries.filter((e) => e.meal === m.key);
        const sub = sumNutrients(list.map((e) => e.total));
        const ev = target && profile && list.length > 0 ? evaluateMeal(m.key, sub, target, profile.goal) : null;
        const open = openEval === m.key;
        return (
          <section className="card meal" key={m.key}>
            <div className="meal-head">
              <h2>
                {m.label}
                {list.length > 0 && <span className="muted meal-kcal">{sub.kcal} kcal</span>}
              </h2>
              <div className="meal-actions">
                {ev && (
                  <button className="grade" onClick={() => setOpenEval(open ? null : m.key)} aria-label="끼니 평가 보기">
                    {GRADE_EMOJI[ev.grade]}
                  </button>
                )}
                <button className="chip primary" onClick={() => setAdding(m.key)}>+ 기록</button>
              </div>
            </div>
            {ev && open && (
              <div className="eval">
                <p className="small muted">{GOALS[profile!.goal].label} · 하루 목표의 {Math.round(MEAL_SHARE[m.key] * 100)}% 기준</p>
                <ul className="small">
                  {ev.reasons.map((r) => <li key={r.text}>{GRADE_EMOJI[r.grade]} {r.text}</li>)}
                </ul>
              </div>
            )}
            {list.length > 0 && (
              <ul className="entries">
                {list.map((e) => (
                  <li key={e.id} onClick={() => setEditing(e)} className="entry-row">
                    <div>
                      <div className="entry-title">
                        <span className={`tag ${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                        {e.place ? `${e.place} · ` : ""}{e.title}
                      </div>
                      <NutrientLine n={e.total} />
                    </div>
                    <FavStar getDraft={() => entryDraft(e)} />
                  </li>
                ))}
              </ul>
            )}
            {list.length > 0 && (
              <button className="link small set-save" onClick={() => saveAsSet(m.label, list)}>+ 식사 세트로 저장</button>
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
