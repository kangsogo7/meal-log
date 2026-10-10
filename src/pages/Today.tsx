import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, KIND_LABEL, MEALS, sumNutrients, todayStr, type Entry, type Meal } from "../db";
import { useProfile, useTargets } from "../hooks";
import { DateNav, NutrientLine, Sheet } from "../components/ui";
import { Ring } from "../components/charts";
import { evaluateMeal, GOALS, GRADE_LABEL, MEAL_SHARE, SODIUM_LIMIT } from "../nutrition";
import AddSheet, { loadAddDraft, type AddDraft } from "./AddSheet";
import { entryDraft, FavStar } from "../favorites";
import EntrySheet from "./EntrySheet";
import WeeklyCard from "./WeeklyCard";

/** 끼니의 기록들을 식사 세트로 저장 (즐겨찾기 탭에서 한 번에 기록) */
async function saveAsSet(mealLabel: string, list: Entry[]) {
  const name = prompt("식사 세트 이름", `${mealLabel} 세트`)?.trim();
  if (!name) return;
  try {
    await db.sets.add({
      name,
      entries: list.map((e) => ({ kind: e.kind, title: e.title, place: e.place, items: e.items, k: e.k })),
      total: sumNutrients(list.map((e) => e.total)),
      updatedAt: Date.now(),
    });
    alert(`"${name}" 세트를 저장했어요. 기록할 때 즐겨찾기 탭에서 한 번에 넣을 수 있어요.`);
  } catch (err) {
    alert(`저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export default function Today({ onGoToGoals }: { onGoToGoals: () => void }) {
  // 쓰던 기록 창이 있으면(앱이 다시 시작된 경우) 그대로 다시 열기
  const [restore, setRestore] = useState<AddDraft | null>(loadAddDraft);
  const [date, setDate] = useState(restore?.date ?? todayStr());
  const [adding, setAdding] = useState<Meal | null>(restore?.meal ?? null);
  const [editing, setEditing] = useState<Entry | null>(null);
  // 끼니 타일을 누르면 그 끼니 기록을 시트로
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const { target } = useTargets(date);
  const profile = useProfile();

  const entries = useLiveQuery(() => db.entries.where("date").equals(date).sortBy("createdAt"), [date], []);
  const total = sumNutrients(entries.map((e) => e.total));
  const remain = target ? target.kcal - total.kcal : 0;
  const macro = (key: "carb" | "protein" | "fat", label: string) => {
    const t = target?.[key] ?? 0;
    return (
      <div className={`macro-row ${key}`}>
        <div className="row-between">
          <span className="macro-name"><i aria-hidden />{label}</span>
          <b>{Math.round(total[key])}{t ? <span className="muted">/{Math.round(t)}g</span> : "g"}</b>
        </div>
        <div className="progress"><div className={t && total[key] > t * 1.05 ? "over" : ""} style={{ width: `${t ? Math.min(100, (total[key] / t) * 100) : 0}%` }} /></div>
      </div>
    );
  };
  const meal = openMeal ? MEALS.find((m) => m.key === openMeal)! : null;

  return (
    <>
      <DateNav date={date} onChange={setDate} />

      <section className="card today-summary">
        <Ring value={total.kcal} max={target?.kcal ?? 0} label={`칼로리 ${Math.round(total.kcal)} / ${target?.kcal ?? "-"}kcal`}>
          {target ? (
            <>
              <b className="ring-num">{Math.abs(Math.round(remain)).toLocaleString()}</b>
              <span className="muted small">{remain >= 0 ? "kcal 남음" : "kcal 초과"}</span>
            </>
          ) : (
            <>
              <b className="ring-num">{Math.round(total.kcal).toLocaleString()}</b>
              <span className="muted small">kcal</span>
            </>
          )}
        </Ring>
        <div className="macro-list">
          {macro("carb", "탄수화물")}
          {macro("protein", "단백질")}
          {macro("fat", "지방")}
          <div className="row-between sodium-line muted small">
            <span>나트륨</span>
            <span className={(total.sodium ?? 0) > (target?.sodium ?? SODIUM_LIMIT) ? "over-text" : ""}>
              {Math.round(total.sodium ?? 0).toLocaleString()} / {(target?.sodium ?? SODIUM_LIMIT).toLocaleString()}mg
            </span>
          </div>
          {!target && <button className="link small" onClick={onGoToGoals}>목표 설정하기 →</button>}
        </div>
      </section>

      <div className="meal-tiles">
        {MEALS.map((m) => {
          const list = entries.filter((e) => e.meal === m.key);
          if (!list.length) {
            return (
              <button key={m.key} className="meal-tile add" onClick={() => setAdding(m.key)}>
                <b className="plus" aria-hidden>+</b>
                <b>{m.label} 기록</b>
                {target && <span className="muted small">{Math.max(0, Math.round(remain)).toLocaleString()}kcal 남음</span>}
              </button>
            );
          }
          const sub = sumNutrients(list.map((e) => e.total));
          const ev = target && profile ? evaluateMeal(m.key, sub, target, profile.goal) : null;
          return (
            <button key={m.key} className="meal-tile" onClick={() => setOpenMeal(m.key)}>
              <span className="row-between">
                <b className="tile-name">{m.label}</b>
                {ev && <span className={`grade-chip ${ev.grade}`}>{GRADE_LABEL[ev.grade]}</span>}
              </span>
              <b className="tile-kcal">{Math.round(sub.kcal).toLocaleString()}<span className="muted"> kcal</span></b>
              <span className="muted small tile-sub">{list[0].title}{list.length > 1 ? ` 외 ${list.length - 1}개` : ""}</span>
            </button>
          );
        })}
      </div>

      {meal && (() => {
        const list = entries.filter((e) => e.meal === meal.key);
        const sub = sumNutrients(list.map((e) => e.total));
        const ev = target && profile && list.length ? evaluateMeal(meal.key, sub, target, profile.goal) : null;
        return (
          <Sheet
            title={`${meal.label} · ${Math.round(sub.kcal).toLocaleString()}kcal`}
            onClose={() => setOpenMeal(null)}
            footer={
              <>
                {list.length > 0 && <button onClick={() => saveAsSet(meal.label, list)}>식사 세트로 저장</button>}
                <span className="spacer" />
                <button className="primary" onClick={() => { setOpenMeal(null); setAdding(meal.key); }}>+ 추가</button>
              </>
            }
          >
            {ev && (
              <div className="eval">
                <p className="small muted"><span className={`grade-chip ${ev.grade}`}>{GRADE_LABEL[ev.grade]}</span> {GOALS[profile!.goal].label} · 하루 목표의 {Math.round(MEAL_SHARE[meal.key] * 100)}% 기준</p>
                <ul className="small">
                  {ev.reasons.map((r) => <li key={r.text}><i className={`grade-dot ${r.grade}`} aria-hidden /> {r.text}</li>)}
                </ul>
              </div>
            )}
            {list.length ? (
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
            ) : (
              <p className="muted small">기록이 없어요</p>
            )}
          </Sheet>
        );
      })()}

      <WeeklyCard date={date} onSelect={setDate} />

      {adding && <AddSheet date={date} meal={adding} restore={restore?.meal === adding ? restore : null} onClose={() => { setAdding(null); setRestore(null); }} />}
      {editing && <EntrySheet entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
