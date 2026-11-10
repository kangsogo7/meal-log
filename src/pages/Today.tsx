import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, EXTRAS, KIND_LABEL, MEALS, sumNutrients, todayStr, type Entry, type Meal } from "../db";
import { useTargets } from "../hooks";
import { Btn, BtnRow, DateNav, ExtrasList, flash, FoodList, FoodRow, macroLine, NutrientGrid, FullScreen, Sheet, TextInput } from "../components/ui";
import { SplitRing } from "../components/charts";
import { evaluateMeal, GOALS, GRADE_LABEL, MEAL_SHARE, SODIUM_LIMIT } from "../nutrition";
import AddSheet, { loadAddDraft, type AddDraft } from "./AddSheet";
import { entryDraft, FavStar } from "../favorites";
import EntrySheet from "./EntrySheet";
import WeeklyCard from "./WeeklyCard";
import { CheckSteps, CheckTiles, CheckWeekCard } from "./Checks";
import { cheatInWeek, setCheat, useCheatDays } from "../cheat";

/** 끼니의 기록들을 식사 세트로 저장 (즐겨찾기 탭에서 한 번에 기록) */
const DOWS = ["일", "월", "화", "수", "목", "금", "토"];
/** "10/28(수)" */
const mdDow = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${m}/${day}(${DOWS[new Date(y, m - 1, day).getDay()]})`;
};

/** 끼니의 기록들을 식사 세트로 저장하는 창: 이름 + 넣을 음식 고르기 */
function SaveSetSheet({ mealLabel, list, onClose }: { mealLabel: string; list: Entry[]; onClose: () => void }) {
  const [name, setName] = useState(`${mealLabel} 세트`);
  const [off, setOff] = useState<Set<number>>(new Set());
  const chosen = list.filter((e) => !off.has(e.id!));
  const kcal = Math.round(sumNutrients(chosen.map((e) => e.total)).kcal);
  const toggle = (id: number) => setOff((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    try {
      await db.sets.add({
        name: name.trim(),
        entries: chosen.map((e) => ({ kind: e.kind, title: e.title, place: e.place, items: e.items, k: e.k })),
        total: sumNutrients(chosen.map((e) => e.total)),
        updatedAt: Date.now(),
      });
      flash(`"${name.trim()}" 세트를 저장했어요`);
      onClose();
    } catch (err) {
      flash(`저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}`, 4000);
    }
  };
  return (
    <Sheet
      title="식사 세트로 저장"
      onClose={onClose}
      footer={
        <BtnRow>
          <Btn onClick={onClose}>취소</Btn>
          <Btn kind="primary" onClick={save} disabled={!name.trim() || !chosen.length}>저장</Btn>
        </BtnRow>
      }
    >
      <div className="form">
        <label>세트 이름<TextInput value={name} onChange={setName} /></label>
        <div className="row-between muted small"><span>넣을 음식</span><span>{chosen.length}개 · {kcal.toLocaleString()}kcal</span></div>
        <FoodList>
          {list.map((e) => (
            <FoodRow
              key={e.id}
              title={e.title}
              kcal={e.total.kcal}
              onClick={() => toggle(e.id!)}
              trailing={<input type="checkbox" className="fr-check" checked={!off.has(e.id!)} onChange={() => toggle(e.id!)} aria-label={`${e.title} 넣기`} />}
            />
          ))}
        </FoodList>
      </div>
    </Sheet>
  );
}

export default function Today({ onGoToGoals, openChecks = 0 }: { onGoToGoals: () => void; /** 늘어나면 물·영양제 창 열기 (알림을 누른 경우) */ openChecks?: number }) {
  // 쓰던 기록 창이 있으면(앱이 다시 시작된 경우) 그대로 다시 열기
  const [restore, setRestore] = useState<AddDraft | null>(loadAddDraft);
  const [date, setDate] = useState(restore?.date ?? todayStr());
  const [adding, setAdding] = useState<Meal | null>(restore?.meal ?? null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [saveSet, setSaveSet] = useState<{ label: string; list: Entry[] } | null>(null);
  // 끼니 타일을 누르면 그 끼니 기록을 시트로
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  // 물·영양제 창 (알림을 눌러 들어오면 오늘 날짜로 열기)
  const [checksOpen, setChecksOpen] = useState(false);
  useEffect(() => {
    if (!openChecks) return;
    setDate(todayStr());
    setChecksOpen(true);
  }, [openChecks]);
  // 지난 날은 그때 목표로 평가
  const { target, profile } = useTargets(date);
  // 치팅데이: 그날 끼니는 평가하지 않음 (주간 평가·칼로리 조정 판단에서도 빠짐)
  const cheats = useCheatDays();
  const cheat = cheats.includes(date);
  const toggleCheat = () => {
    if (cheat) return setCheat(date, false);
    const other = cheatInWeek(cheats, date);
    if (other && !confirm(`치팅데이는 일주일에 하루예요. 이번 주 치팅데이(${mdDow(other)})를 ${mdDow(date)}로 옮길까요?`)) return;
    setCheat(date, true);
  };

  const entries = useLiveQuery(() => db.entries.where("date").equals(date).sortBy("createdAt"), [date], []);
  const total = sumNutrients(entries.map((e) => e.total));
  const remain = target ? target.kcal - total.kcal : 0;
  const meal = openMeal ? MEALS.find((m) => m.key === openMeal)! : null;

  return (
    <>
      <DateNav date={date} onChange={setDate} />
      <div className="cheat-row">
        {cheat ? (
          <>
            <span className="cheat-chip">🍕 치팅데이</span>
            <button className="link small" onClick={toggleCheat}>해제</button>
          </>
        ) : (
          <button className="link small muted-link" onClick={toggleCheat}>🍕 치팅데이로 지정</button>
        )}
      </div>

      <section className="card today-summary">
        <div className="ts-top">
          <span className="ts-label">칼로리</span>
          <span className="ts-label right">영양성분</span>
          <SplitRing
            kcal={{ value: total.kcal, max: target?.kcal ?? 0 }}
            macros={[
              { key: "carb", value: total.carb, max: target?.carb ?? 0 },
              { key: "protein", value: total.protein, max: target?.protein ?? 0 },
              { key: "fat", value: total.fat, max: target?.fat ?? 0 },
            ]}
          >
            {target ? (
              <>
                <b className="ring-num">{Math.abs(Math.round(remain)).toLocaleString()}</b>
                <span className="muted small">{remain >= 0 ? "kcal 남음" : "kcal 초과"}</span>
                <span className="muted small">{Math.round(total.kcal).toLocaleString()} / {target.kcal.toLocaleString()}</span>
              </>
            ) : (
              <>
                <b className="ring-num">{Math.round(total.kcal).toLocaleString()}</b>
                <span className="muted small">kcal</span>
              </>
            )}
          </SplitRing>
        </div>
        <hr className="ts-line" />
        <div className="ts-cells">
          {([["carb", "탄수화물"], ["protein", "단백질"], ["fat", "지방"]] as const).map(([k, label]) => (
            <div key={k} className={`ts-cell ${k}`}>
              <span className="muted small"><i aria-hidden />{label}</span>
              <b className={target && total[k] > target[k] * 1.05 ? "over-text" : ""}>{Math.round(total[k])}g</b>
              <span className="muted small">{target ? `/ ${Math.round(target[k])}g` : ""}</span>
            </div>
          ))}
          <div className="ts-cell sodium">
            <span className="muted small"><i aria-hidden />나트륨</span>
            <b className={(total.sodium ?? 0) > (target?.sodium ?? SODIUM_LIMIT) ? "over-text" : ""}>{Math.round(total.sodium ?? 0).toLocaleString()}mg</b>
            <span className="muted small">/ {(target?.sodium ?? SODIUM_LIMIT).toLocaleString()}mg</span>
          </div>
        </div>
        {EXTRAS.some(({ key }) => total[key] != null) && (
          <details className="day-extras">
            <summary className="muted small">세부 영양</summary>
            <ExtrasList n={total} always />
          </details>
        )}
        <hr className="ts-line" />
        <CheckSteps date={date} onOpen={() => setChecksOpen(true)} />
        {!target && <button className="link small" onClick={onGoToGoals}>목표 설정하기 →</button>}
      </section>

      <div className="meal-tiles">
        {MEALS.map((m) => {
          const list = entries.filter((e) => e.meal === m.key);
          if (!list.length) {
            return (
              <button key={m.key} className="meal-tile add" onClick={() => setAdding(m.key)}>
                <b className="plus" aria-hidden>+</b>
                <b><span className="meal-ic" aria-hidden>{m.icon}</span>{m.label} 기록</b>
                {target && <span className="muted small">{Math.max(0, Math.round(remain)).toLocaleString()}kcal 남음</span>}
              </button>
            );
          }
          const sub = sumNutrients(list.map((e) => e.total));
          const ev = target && profile && !cheat ? evaluateMeal(m.key, sub, target, profile.goal) : null;
          return (
            <button key={m.key} className="meal-tile" onClick={() => setOpenMeal(m.key)}>
              <span className="row-between">
                <b className="tile-name"><span className="meal-ic" aria-hidden>{m.icon}</span>{m.label}</b>
                {ev && <span className={`grade-chip ${ev.grade}`}>{GRADE_LABEL[ev.grade]}</span>}
                {cheat && <span className="grade-chip cheat">치팅</span>}
              </span>
              <b className="tile-kcal">{Math.round(sub.kcal).toLocaleString()}<span className="muted"> kcal</span></b>
              <span className="muted small tile-sub">{list[0].title}{list.length > 1 ? ` 외 ${list.length - 1}개` : ""}</span>
            </button>
          );
        })}
      </div>

      <CheckTiles tiles={false} date={date} open={checksOpen} onOpen={() => setChecksOpen(true)} onClose={() => setChecksOpen(false)} />

      {meal && (() => {
        const list = entries.filter((e) => e.meal === meal.key);
        const sub = sumNutrients(list.map((e) => e.total));
        const ev = target && profile && list.length && !cheat ? evaluateMeal(meal.key, sub, target, profile.goal) : null;
        return (
          <FullScreen
            title={`${meal.icon} ${meal.label} · ${Math.round(sub.kcal).toLocaleString()}kcal`}
            onClose={() => setOpenMeal(null)}
            footer={
              <>
                {list.length > 0 && <button onClick={() => setSaveSet({ label: meal.label, list })}>식사 세트로 저장</button>}
                <span className="spacer" />
                <button className="primary" onClick={() => { setOpenMeal(null); setAdding(meal.key); }}>+ 추가</button>
              </>
            }
          >
            {/* 이 끼니 합계: 칼로리·탄단지·나트륨·세부 영양 */}
            {list.length > 0 && <div className="meal-sum"><NutrientGrid n={sub} /></div>}
            {cheat && list.length > 0 && <p className="small muted">🍕 치팅데이라 이 끼니는 평가하지 않아요</p>}
            {ev && (
              <div className="eval">
                <p className="small muted"><span className={`grade-chip ${ev.grade}`}>{GRADE_LABEL[ev.grade]}</span> {GOALS[profile!.goal].label} · 하루 목표의 {Math.round(MEAL_SHARE[meal.key] * 100)}% 기준</p>
                <div className="eval-cells">
                  {ev.cells.map((c) => (
                    <div key={c.key} className="eval-cell">
                      <span className="muted small">{c.label}</span>
                      <b>{c.value}</b>
                      <span className="muted small">하루 {Math.round(c.dayPct * 100)}%</span>
                      <span className={`eval-word ${c.grade ?? "none"}`}>{c.word}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {list.length ? (
              <FoodList>
                {list.map((e) => (
                  <FoodRow
                    key={e.id}
                    title={e.title}
                    place={e.place}
                    sub={`${KIND_LABEL[e.kind]} · ${macroLine(e.total)}`}
                    kcal={e.total.kcal}
                    onClick={() => setEditing(e)}
                    trailing={<FavStar getDraft={() => entryDraft(e)} />}
                  />
                ))}
              </FoodList>
            ) : (
              <p className="muted small">기록이 없어요</p>
            )}
          </FullScreen>
        );
      })()}

      <WeeklyCard date={date} onSelect={setDate} />
      <CheckWeekCard date={date} />

      {adding && <AddSheet date={date} meal={adding} restore={restore?.meal === adding ? restore : null} onClose={() => { setAdding(null); setRestore(null); }} />}
      {saveSet && <SaveSetSheet mealLabel={saveSet.label} list={saveSet.list} onClose={() => setSaveSet(null)} />}
      {editing && <EntrySheet entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
