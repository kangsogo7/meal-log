import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, EXTRAS, KIND_LABEL, MEALS, photoKey, sumNutrients, todayStr, type Entry, type Meal } from "../db";
import { useTargets } from "../hooks";
import { Btn, BtnRow, Dialog, MealSeg, DateButton, DateNav, ExtrasList, flash, FoodList, FoodRow, NutrientGrid, FullScreen, Sheet, TextInput, Seg } from "../components/ui";
import Ring from "../components/Ring";
import { useDayCheck, useHydration, useSupplements } from "../checks";
import CameraScreen from "../components/CameraScreen";
import { SODIUM_LIMIT } from "../nutrition";
import AddSheet, { loadAddDraft, type AddDraft } from "./AddSheet";
import { entryDraft, FavStar } from "../favorites";
import EntrySheet from "./EntrySheet";
import WeeklyCard from "./WeeklyCard";
import { analyzePhotoEntry, recordPhotoMeal, resumePhotoMeals } from "../photoMeal";
import { CheckTiles, CheckWeekCard } from "./Checks";
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
function useMealPhotos(date: string): Record<string, string> {
  const rows = useLiveQuery(() => db.photos.where("date").equals(date).toArray(), [date], []);
  const urls = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, URL.createObjectURL(r.blob)])) as Record<string, string>, [rows]);
  useEffect(() => () => Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return urls;
}

/** 사진으로 바로 기록한 것은 분석 상태로 */
const entryTitle = (e: Entry) => (e.pending === "ai" ? "AI가 사진 분석 중..." : e.pending === "failed" ? "사진 분석 실패 · 눌러서 다시" : e.title);

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
  const [view, setView] = useState<"today" | "week" | "checks">("today");
  const [saveSet, setSaveSet] = useState<{ label: string; list: Entry[] } | null>(null);
  // 끼니 타일을 누르면 그 끼니 기록을 시트로
  const [openId, setOpenId] = useState<number | null>(null);
  // 물·영양제 창 (알림을 눌러 들어오면 오늘 날짜로 열기)
  const [checksOpen, setChecksOpen] = useState(false);
  // 사진 찍기: new = + 버튼(찍고 기록), 끼니 = 그 끼니 사진 바꾸기
  const [cam, setCam] = useState<"new" | number | null>(null);
  // 사진으로 기록한 뒤 "기록했어요" 창 (끼니를 바로 바꿀 수 있게)
  const [recorded, setRecorded] = useState<{ id: number; meal: Meal } | null>(null);
  const [addPhoto, setAddPhoto] = useState<Blob | null>(null);
  const photos = useMealPhotos(date);
  // 끼니 사진(예전 방식) · 기록마다 사진(사진으로 바로 기록)
  const mealPhoto = (m: Meal): string | undefined => photos[photoKey(date, m)];
  const week = weekOf(date);
  const weekDone = useLiveQuery(async () => new Set((await db.entries.where("date").between(week[0], week[6], true, true).toArray()).map((e) => e.date)), [week[0]], new Set<string>());
  useEffect(() => {
    if (!openChecks) return;
    setDate(todayStr());
    setView("checks");
    setChecksOpen(true);
  }, [openChecks]);
  useEffect(() => {
    if (!openAdd) return;
    setDate(todayStr());
    setView("today");
    setAdding(openAdd.meal);
  }, [openAdd?.n]);
  // 지난 날은 그때 목표로 평가
  const { target } = useTargets(date);
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
  // 기록 사진: 기록마다 사진, 없으면 예전 끼니 사진을 그 끼니의 사진 없는 첫 기록에
  const legacyOf = (m: Meal) => entries.find((x) => x.meal === m && (!x.photo || !photos[x.photo]));
  const photoOf = (e: Entry): { src: string; own: boolean } | null =>
    e.photo && photos[e.photo] ? { src: photos[e.photo], own: true } : legacyOf(e.meal) === e && mealPhoto(e.meal) ? { src: mealPhoto(e.meal)!, own: false } : null;
  const opened = openId != null ? entries.find((e) => e.id === openId) ?? null : null;
  // 물·영양제 원형 그래프
  const hyd = useHydration();
  const supps = useSupplements();
  const dayCheck = useDayCheck(date);
  const cups = Math.max(1, Math.ceil(hyd.goalMl / hyd.cupMl));
  const filled = Math.floor(dayCheck.waterMl / hyd.cupMl);
  const suppTaken = supps.filter((s) => dayCheck.supps[s.id]).length;
  // 분석 중에 앱이 닫혔던 사진 기록은 다시 분석
  useEffect(() => { resumePhotoMeals(); }, []);
  const removePhoto = async (e: Entry) => {
    const ph = photoOf(e);
    if (!ph) return;
    const key = ph.own ? e.photo! : photoKey(date, e.meal);
    const old = await db.photos.get(key);
    await db.photos.delete(key);
    if (ph.own) await db.entries.update(e.id!, { photo: undefined });
    if (old) flash("사진을 지웠어요", 4000, { label: "되돌리기", run: () => void (async () => { await db.photos.put(old); if (ph.own) await db.entries.update(e.id!, { photo: key }); })() });
  };
  const changePhoto = async (e: Entry, blob: Blob) => {
    const ph = photoOf(e);
    if (ph && !ph.own) await db.photos.delete(photoKey(date, e.meal));
    if (ph?.own) await db.photos.delete(e.photo!);
    const at = Date.now();
    const key = `${photoKey(date, e.meal)}|${at}`;
    await db.photos.put({ key, date, meal: e.meal, blob, at });
    await db.entries.update(e.id!, { photo: key });
  };


  return (
    <>
      <div className="view-tabs-row">
        <Seg className="fit" label="보기" value={view} onChange={setView} options={[{ key: "today", label: "오늘" }, { key: "week", label: "주간" }, { key: "checks", label: "물/영양제" }]} />
      </div>
      {view !== "today" && <DateNav date={date} onChange={setDate} />}
      {view === "today" && (
        <div className="home">
          <div className="home-head">
            <div className="home-date">
              <DateButton className="home-date-btn" value={date} onChange={setDate}>{longDate(date)}</DateButton>
              {date !== todayStr() && <button className="chip" onClick={() => setDate(todayStr())}>오늘</button>}
            </div>
            <div className="home-top">
              <div>
                <div className="home-kcal">
                  <b>{Math.round(total.kcal).toLocaleString()}</b>
                  <span>{target ? `/ ${target.kcal.toLocaleString()} kcal` : "kcal"}</span>
                </div>
                {target && <div className={`home-remain ${remain < 0 ? "over" : ""}`}>{Math.abs(Math.round(remain)).toLocaleString()} kcal {remain >= 0 ? "남음" : "초과"}</div>}
              </div>
              <div className="home-rings">
                <Ring label="칼로리" value={total.kcal} max={target?.kcal ?? 0} over={remain < 0} />
                <Ring label="물" value={filled} max={cups} steps={cups} onClick={() => setView("checks")} />
                <Ring label="영양제" value={suppTaken} max={supps.length} steps={supps.length} onClick={() => setView("checks")} />
              </div>
            </div>
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
            {MEALS.filter((m) => entries.some((e) => e.meal === m.key)).flatMap((m) => {
              const list = entries.filter((e) => e.meal === m.key);
              // 한 끼에 여러 개면 따로따로
              return list.map((e, i) => {
                const src = photoOf(e)?.src;
                return (
                  <button key={e.id} className="home-meal" onClick={() => setOpenId(e.id!)}>
                    {src ? (
                      <img className="hm-photo" src={src} alt={`${m.label} 사진`} />
                    ) : (
                      <span className="hm-photo none"><b>{entryTitle(e)}</b></span>
                    )}
                    <span className="hm-info">
                      <span className="hm-chips">
                        <span className="hm-chip">{m.label}</span>
                        {i === 0 && cheat && <span className="grade-chip cheat">치팅</span>}
                      </span>
                      <b className="hm-kcal">{Math.round(e.total.kcal).toLocaleString()} kcal</b>
                      <span className="muted small hm-title">{src ? entryTitle(e) : "사진 없이 기록"}</span>
                    </span>
                  </button>
                );
              });
            })}
            {!entries.length && <p className="home-none">아직 기록이 없어요</p>}
          </div>
          <button className="fab" onClick={() => setCam("new")} aria-label="사진 찍고 기록">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
      )}

      <CheckTiles tiles={view === "checks"} date={date} open={checksOpen} onOpen={() => setChecksOpen(true)} onClose={() => setChecksOpen(false)} />

      {opened && (() => {
        const e = opened;
        const m = MEALS.find((x) => x.key === e.meal)!;
        const ph = photoOf(e);
        return (
          <FullScreen
            title={`${m.icon} ${m.label} · ${Math.round(e.total.kcal).toLocaleString()}kcal`}
            onClose={() => setOpenId(null)}
            footer={
              <>
                <Btn onClick={() => setSaveSet({ label: m.label, list: [e] })}>식사 세트로 저장</Btn>
                <span className="spacer" />
                <Btn kind="primary" onClick={() => { setOpenId(null); setAdding(e.meal); }}>+ 추가</Btn>
              </>
            }
          >
            <div className="meal-photo">
              {ph ? <img src={ph.src} alt={`${m.label} 사진`} /> : null}
              <div className="meal-photo-btns">
                <Btn onClick={() => setCam(e.id!)}>{ph ? "사진 바꾸기" : "사진 추가"}</Btn>
                {ph && <Btn onClick={() => removePhoto(e)}>사진 지우기</Btn>}
              </div>
            </div>
            {/* 이 기록의 칼로리·탄단지·나트륨·세부 영양 */}
            <div className="meal-sum"><NutrientGrid n={e.total} /></div>
            <FoodList>
              <FoodRow
                title={entryTitle(e)}
                place={e.place}
                sub={e.pending ? "사진 기록" : KIND_LABEL[e.kind]}
                n={e.total}
                kcal={e.total.kcal}
                onClick={() => (e.pending === "failed" ? analyzePhotoEntry(e.id!) : e.pending === "ai" ? undefined : setEditing(e))}
                trailing={<FavStar getDraft={() => entryDraft(e)} />}
              />
            </FoodList>
          </FullScreen>
        );
      })()}

      {view === "week" && (
        <>
          <WeeklyCard date={date} onSelect={(d) => { setDate(d); setView("today"); }} />
        </>
      )}
      {view === "checks" && <CheckWeekCard date={date} />}

      {adding && <AddSheet date={date} meal={adding} photo={addPhoto} restore={restore?.meal === adding ? restore : null} onClose={() => { setAdding(null); setRestore(null); setAddPhoto(null); }} />}
      {cam && (
        <CameraScreen
          title={cam === "new" ? "카메라" : "사진 바꾸기"}
          onClose={() => setCam(null)}
          onSkip={cam === "new" ? () => { setCam(null); setAddPhoto(null); setAdding(mealNow()); } : undefined}
          onPhoto={async (blob) => {
            if (cam === "new") {
              const meal = mealNow();
              const id = await recordPhotoMeal(date, meal, blob);
              setRecorded({ id, meal });
            } else {
              const e = entries.find((x) => x.id === cam);
              if (e) await changePhoto(e, blob);
            }
            setCam(null);
          }}
        />
      )}
      {recorded && (
        <Dialog title="기록했어요" actions={<Btn kind="primary" onClick={() => setRecorded(null)}>확인</Btn>}>
          <p className="recorded-msg">
            {MEALS.find((m) => m.key === recorded.meal)!.icon} <b>{MEALS.find((m) => m.key === recorded.meal)!.label}</b>(으)로 기록했어요.
            <br /><span className="muted small">AI가 칼로리를 찾는 중이에요. 다른 끼니면 바꿔 주세요.</span>
          </p>
          <MealSeg value={recorded.meal} onChange={(m) => { setRecorded({ ...recorded, meal: m }); void db.entries.update(recorded.id, { meal: m }); }} />
        </Dialog>
      )}
      {saveSet && <SaveSetSheet mealLabel={saveSet.label} list={saveSet.list} onClose={() => setSaveSet(null)} />}
      {editing && <EntrySheet entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
