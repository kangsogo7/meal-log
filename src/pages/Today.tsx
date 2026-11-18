import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, EXTRAS, KIND_LABEL, MEALS, photoKey, setMealPhoto, sumNutrients, todayStr, type Entry, type Meal } from "../db";
import { useTargets } from "../hooks";
import { Btn, BtnRow, DateButton, DateNav, ExtrasList, flash, FoodList, FoodRow, NutrientGrid, FullScreen, Sheet, TextInput, Seg } from "../components/ui";
import CameraScreen from "../components/CameraScreen";
import { evaluateMeal, GOALS, GRADE_LABEL, MEAL_SHARE, SODIUM_LIMIT } from "../nutrition";
import AddSheet, { loadAddDraft, type AddDraft } from "./AddSheet";
import { entryDraft, FavStar } from "../favorites";
import EntrySheet from "./EntrySheet";
import WeeklyCard from "./WeeklyCard";
import { CheckSteps, CheckTiles, CheckWeekCard } from "./Checks";
import { cheatInWeek, setCheat, useCheatDays } from "../cheat";

const DOWS = ["일", "월", "화", "수", "목", "금", "토"];
/** "10/28(수)" */
const mdDow = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${m}/${day}(${DOWS[new Date(y, m - 1, day).getDay()]})`;
};

/** "11월 18일 수요일" */
const longDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${m}월 ${day}일 ${DOWS[new Date(y, m - 1, day).getDay()]}요일`;
};

/** 지금 시각으로 고르는 끼니 (+ 버튼) */
function mealNow(): Meal {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  return h < 10.5 ? "breakfast" : h < 15 ? "lunch" : h < 17.5 ? "snack" : "dinner";
}

/** 그 날짜가 있는 주 (월~일) */
function weekOf(date: string): string[] {
  const [y, m, d] = date.split("-").map(Number);
  const back = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const mon = addDays(date, -back);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/** 날짜의 끼니 사진 → 화면에 쓸 주소 */
function useMealPhotos(date: string): Partial<Record<Meal, string>> {
  const rows = useLiveQuery(() => db.photos.where("date").equals(date).toArray(), [date], []);
  const urls = useMemo(() => Object.fromEntries(rows.map((r) => [r.meal, URL.createObjectURL(r.blob)])) as Partial<Record<Meal, string>>, [rows]);
  useEffect(() => () => Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return urls;
}

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
              n={e.total}
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

export default function Today({ onGoToGoals, openChecks = 0, openAdd }: {
  onGoToGoals: () => void;
  /** 늘어나면 물·영양제 창 열기 (알림을 누른 경우) */ openChecks?: number;
  /** 식단 위젯에서 끼니를 누른 경우: 오늘 그 끼니 기록 화면 */ openAdd?: { meal: Meal; n: number } | null;
}) {
  // 쓰던 기록 창이 있으면(앱이 다시 시작된 경우) 그대로 다시 열기
  const [restore, setRestore] = useState<AddDraft | null>(loadAddDraft);
  const [date, setDate] = useState(restore?.date ?? todayStr());
  const [adding, setAdding] = useState<Meal | null>(restore?.meal ?? null);
  const [editing, setEditing] = useState<Entry | null>(null);
  // 오늘 / 주간 보기
  const [view, setView] = useState<"today" | "week">("today");
  const [saveSet, setSaveSet] = useState<{ label: string; list: Entry[] } | null>(null);
  // 끼니 타일을 누르면 그 끼니 기록을 시트로
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  // 물·영양제 창 (알림을 눌러 들어오면 오늘 날짜로 열기)
  const [checksOpen, setChecksOpen] = useState(false);
  // 사진 찍기: new = + 버튼(찍고 기록), 끼니 = 그 끼니 사진 바꾸기
  const [cam, setCam] = useState<"new" | Meal | null>(null);
  const [addPhoto, setAddPhoto] = useState<Blob | null>(null);
  const photos = useMealPhotos(date);
  const week = weekOf(date);
  const weekDone = useLiveQuery(async () => new Set((await db.entries.where("date").between(week[0], week[6], true, true).toArray()).map((e) => e.date)), [week[0]], new Set<string>());
  useEffect(() => {
    if (!openChecks) return;
    setDate(todayStr());
    setChecksOpen(true);
  }, [openChecks]);
  useEffect(() => {
    if (!openAdd) return;
    setDate(todayStr());
    setView("today");
    setAdding(openAdd.meal);
  }, [openAdd?.n]);
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
  const removePhoto = async (m: Meal) => {
    const old = await db.photos.get(photoKey(date, m));
    await db.photos.delete(photoKey(date, m));
    if (old) flash("사진을 지웠어요", 4000, { label: "되돌리기", run: () => void db.photos.put(old) });
  };

  return (
    <>
      {view === "week" && <DateNav date={date} onChange={setDate} />}
      {view === "week" && <Seg className="today-view" label="보기" value={view} onChange={setView} options={[{ key: "today", label: "오늘" }, { key: "week", label: "주간" }]} />}
      {view === "today" && (
        <div className="home">
          <div className="home-head">
            <div className="home-date">
              <DateButton className="home-date-btn" value={date} onChange={setDate}>{longDate(date)}</DateButton>
              {date !== todayStr() && <button className="chip" onClick={() => setDate(todayStr())}>오늘</button>}
              <span className="spacer" />
              <button className="home-link" onClick={() => setView("week")}>주간</button>
            </div>
            <div className="home-kcal">
              <b>{Math.round(total.kcal).toLocaleString()}</b>
              <span>{target ? `/ ${target.kcal.toLocaleString()} kcal` : "kcal"}</span>
              {target && <span className={`home-remain ${remain < 0 ? "over" : ""}`}>{Math.abs(Math.round(remain)).toLocaleString()} {remain >= 0 ? "남음" : "초과"}</span>}
            </div>
            {target && <div className="home-bar"><i style={{ width: `${Math.min(100, (total.kcal / target.kcal) * 100)}%` }} className={remain < 0 ? "over" : ""} /></div>}
            <div className="home-macros">
              {([["carb", "탄"], ["protein", "단"], ["fat", "지"]] as const).map(([k, label]) => (
                <span key={k}>{label} <b className={target && total[k] > target[k] * 1.05 ? "over-text" : ""}>{Math.round(total[k])}</b>{target ? `/${Math.round(target[k])}g` : "g"}</span>
              ))}
              <span>나트륨 <b className={(total.sodium ?? 0) > (target?.sodium ?? SODIUM_LIMIT) ? "over-text" : ""}>{Math.round(total.sodium ?? 0).toLocaleString()}</b>mg</span>
            </div>
            {EXTRAS.some(({ key }) => total[key] != null) && (
              <details className="day-extras">
                <summary className="muted small">세부 영양</summary>
                <ExtrasList n={total} always />
              </details>
            )}
            {!target && <button className="link small" onClick={onGoToGoals}>목표 설정하기 →</button>}
          </div>

          <div className="home-week">
            {week.map((d, i) => (
              <button key={d} className={`hw-day ${d === date ? "on" : ""} ${d > todayStr() ? "future" : ""}`} onClick={() => setDate(d)} aria-label={longDate(d)}>
                <span>{DOWS[(i + 1) % 7]}</span>
                <b>{Number(d.slice(8))}</b>
                <i className={weekDone.has(d) ? "dot" : ""} aria-hidden />
              </button>
            ))}
          </div>

          <div className="home-sheet">
            <div className="cheat-row">
              {cheat ? (
                <>
                  <span className="cheat-chip">🍕 치팅데이</span>
                  <button className="link small" onClick={toggleCheat}>해제</button>
                </>
              ) : (
                <button className="link small muted-link" onClick={toggleCheat}>치팅데이로 지정</button>
              )}
            </div>
            {MEALS.filter((m) => entries.some((e) => e.meal === m.key)).map((m) => {
              const list = entries.filter((e) => e.meal === m.key);
              const sub = sumNutrients(list.map((e) => e.total));
              const ev = target && profile && !cheat ? evaluateMeal(m.key, sub, target, profile.goal) : null;
              const more = list.length > 1 ? `외 ${list.length - 1}개` : "";
              return (
                <button key={m.key} className="home-meal" onClick={() => setOpenMeal(m.key)}>
                  {photos[m.key] ? (
                    <img className="hm-photo" src={photos[m.key]} alt={`${m.label} 사진`} />
                  ) : (
                    <span className="hm-photo none"><b>{list[0].title}</b>{more && <span className="muted small">{more}</span>}</span>
                  )}
                  <span className="hm-info">
                    <span className="hm-chips">
                      <span className="hm-chip">{m.label}</span>
                      {ev && <span className={`grade-chip ${ev.grade}`}>{GRADE_LABEL[ev.grade]}</span>}
                      {cheat && <span className="grade-chip cheat">치팅</span>}
                    </span>
                    <b className="hm-kcal">{Math.round(sub.kcal).toLocaleString()} kcal</b>
                    <span className="muted small hm-title">{photos[m.key] ? `${list[0].title} ${more}`.trim() : "사진 없이 기록"}</span>
                  </span>
                </button>
              );
            })}
            {MEALS.some((m) => !entries.some((e) => e.meal === m.key)) && (
              <div className="home-empty">
                {MEALS.filter((m) => !entries.some((e) => e.meal === m.key)).map((m) => (
                  <button key={m.key} onClick={() => setAdding(m.key)}>+ {m.label}</button>
                ))}
              </div>
            )}
            <div className="home-checks"><CheckSteps date={date} onOpen={() => setChecksOpen(true)} /></div>
          </div>
          <button className="fab" onClick={() => setCam("new")} aria-label="사진 찍고 기록">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
      )}

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
                {list.length > 0 && <Btn onClick={() => setSaveSet({ label: meal.label, list })}>식사 세트로 저장</Btn>}
                <span className="spacer" />
                <Btn kind="primary" onClick={() => { setOpenMeal(null); setAdding(meal.key); }}>+ 추가</Btn>
              </>
            }
          >
            <div className="meal-photo">
              {photos[meal.key] ? <img src={photos[meal.key]} alt={`${meal.label} 사진`} /> : null}
              <div className="meal-photo-btns">
                <Btn onClick={() => setCam(meal.key)}>{photos[meal.key] ? "사진 바꾸기" : "사진 추가"}</Btn>
                {photos[meal.key] && <Btn onClick={() => removePhoto(meal.key)}>사진 지우기</Btn>}
              </div>
            </div>
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
                    sub={KIND_LABEL[e.kind]}
                    n={e.total}
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

      {view === "week" && (
        <>
          <WeeklyCard date={date} onSelect={(d) => { setDate(d); setView("today"); }} />
          <CheckWeekCard date={date} />
        </>
      )}

      {adding && <AddSheet date={date} meal={adding} photo={addPhoto} restore={restore?.meal === adding ? restore : null} onClose={() => { setAdding(null); setRestore(null); setAddPhoto(null); }} />}
      {cam && (
        <CameraScreen
          title={cam === "new" ? "카메라" : `${MEALS.find((m) => m.key === cam)!.label} 사진`}
          onClose={() => setCam(null)}
          onSkip={cam === "new" ? () => { setCam(null); setAddPhoto(null); setAdding(mealNow()); } : undefined}
          onPhoto={async (blob) => {
            if (cam === "new") {
              setAddPhoto(blob);
              setAdding(mealNow());
            } else {
              await setMealPhoto(date, cam, blob);
            }
            setCam(null);
          }}
        />
      )}
      {saveSet && <SaveSetSheet mealLabel={saveSet.label} list={saveSet.list} onClose={() => setSaveSet(null)} />}
      {editing && <EntrySheet entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
