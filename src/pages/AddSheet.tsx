import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { baseServing, db, MEALS, savedKey, sumNutrients, type Entry, type Item, type Meal } from "../db";
import { Dialog, flash, FoodList, FoodRow, MealTitle, Screen, BackButton, Btn } from "../components/ui";
import SearchForm from "./SearchForm";
import HomeForm from "./HomeForm";
import ManualForm from "./ManualForm";
import PhotoForm from "./PhotoForm";
import QuickAdd from "./QuickAdd";

/** quick: 첫 화면(검색칸 + 자주 먹는 것) / home: 재료로 요리 / manual: 숫자 입력 / photo: 사진 */
type Mode = "quick" | "home" | "manual" | "photo";

export interface Draft {
  kind: Entry["kind"];
  title: string;
  place?: string;
  items: Item[];
  k?: number; // 양 조절 배수
}

/** 기록 저장 + 다음에 다시 쓰도록 메뉴 저장. 저장한 기록의 id */
export async function saveEntry(date: string, meal: Meal, d: Draft, memo?: string) {
  const total = sumNutrients(d.items.map((i) => i.nutrients));
  const id = await db.entries.add({ date, meal, kind: d.kind, title: d.title, place: d.place, items: d.items, total, k: d.k, memo, createdAt: Date.now() });
  const key = savedKey(d.kind, d.place, d.title);
  const prev = await db.saved.get(key);
  // 즐겨찾기·최근 메뉴에는 양 조절 전 1회 제공량으로
  const base = baseServing(d.items, d.k);
  await db.saved.put({ key, kind: d.kind, title: d.title, place: d.place, items: base, total: sumNutrients(base.map((i) => i.nutrients)), uses: (prev?.uses ?? 0) + 1, updatedAt: Date.now(), groupId: prev?.groupId });
  return id as number;
}

// 기록 창을 연 채 홈 화면에 갔다가 폰이 앱을 정리해도, 30분 안에 돌아오면 쓰던 그대로 다시 열기
const DRAFT_KEY = "meal-log-add-draft";
export interface AddDraft { date: string; meal: Meal; mode: Mode; query: string; at: number }
export function loadAddDraft(): AddDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as AddDraft | null;
    return d && Date.now() - d.at < 30 * 60 * 1000 ? d : null;
  } catch {
    return null;
  }
}
const saveAddDraft = (d: AddDraft | null) => {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 저장 못 해도 기록에는 영향 없음 */
  }
};

const MODE_TITLE: Record<Exclude<Mode, "quick">, string> = { photo: "사진", home: "재료로 요리", manual: "숫자 입력" };

export default function AddSheet({ date, meal: initialMeal, onClose: close, restore }: { date: string; meal: Meal; onClose: () => void; restore?: AddDraft | null }) {
  const onClose = () => {
    saveAddDraft(null);
    close();
  };
  const [meal, setMeal] = useState<Meal>(initialMeal);
  // 예전 형식(검색·외식·식품 화면)으로 저장된 쓰던 창은 첫 화면 검색으로
  const old = restore?.mode as string | undefined;
  const [mode, setMode] = useState<Mode>(old === "home" || old === "manual" || old === "photo" ? old : "quick");
  const [query, setQuery] = useState(restore?.query ?? "");
  // 기록하고 나면 검색칸을 비우려고 검색 화면을 새로 만듦
  const [searchKey, setSearchKey] = useState(0);
  useEffect(() => saveAddDraft({ date, meal, mode, query, at: Date.now() }), [date, meal, mode, query]);

  const mealLabel = MEALS.find((m) => m.key === meal)!.label;
  const recordLabel = `${mealLabel}에 기록`;
  // 이 끼니에 이미 기록한 것 (바로 빼기)
  const logged = useLiveQuery(async () => (await db.entries.where("date").equals(date).toArray()).filter((e) => e.meal === meal).sort((a, b) => a.createdAt - b.createdAt), [date, meal], []);
  const loggedKcal = Math.round(sumNutrients(logged.map((e) => e.total)).kcal);

  /** 고른 음식은 바로 기록 (알림에서 되돌리기) */
  const record = async (list: Draft[], label?: string) => {
    if (!list.length) return;
    try {
      const ids: number[] = [];
      for (const d of list) ids.push(await saveEntry(date, meal, d));
      const name = label ?? (list.length === 1 ? list[0].title : `${list.length}개`);
      flash(`${name} 기록했어요`, 4000, { label: "되돌리기", run: () => db.entries.bulkDelete(ids) });
      setQuery("");
      setSearchKey((k) => k + 1);
      setMode("quick");
    } catch (e) {
      alert(`저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 이미 기록한 것을 빼기 전에 한 번 더 물어봄
  const [confirmDel, setConfirmDel] = useState<Entry | null>(null);
  const remove = async (e: Entry) => {
    setConfirmDel(null);
    await db.entries.delete(e.id!);
    flash(`${e.title} 삭제했어요`, 4000, { label: "되돌리기", run: () => db.entries.add(e) });
  };

  return (
    <Screen
      left={<BackButton onClick={() => (mode === "quick" ? onClose() : setMode("quick"))} />}
      title={<MealTitle meal={meal} suffix={mode === "quick" ? " 기록" : ` · ${MODE_TITLE[mode]}`} onChange={setMeal} />}
      footer={mode === "home" || mode === "manual" ? <div id="add-foot" /> : undefined}
    >
      {mode === "quick" && (
        <>
          <SearchForm key={searchKey} onSave={(d) => record([d])} actionLabel={recordLabel} initialQuery={query} onQueryChange={setQuery} trailing={
            <>
              <button className="sf-mode" onClick={() => setMode("photo")} aria-label="사진으로 기록">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              </button>
              <button className="sf-mode" onClick={() => setMode("home")} aria-label="재료로 요리">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 11h14v1a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6v-1Z" /><path d="M17 12h4" /><path d="M8 7c0-1 1-1 1-2M12 7c0-1 1-1 1-2" /></svg>
              </button>
              <button className="sf-mode" onClick={() => setMode("manual")} aria-label="숫자로 직접 입력">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 13h8M8 17h4" /></svg>
              </button>
            </>
          } />
          {!query.trim() && (
            <>
              {logged.length > 0 && (
                <FoodList head={<><span>오늘 {mealLabel}</span><span>{logged.length}개 · {loggedKcal.toLocaleString()}kcal</span></>}>
                  {logged.map((e) => (
                    <FoodRow
                      key={e.id}
                      title={e.title}
                      n={e.total}
                      kcal={e.total.kcal}
                      trailing={<button className="del-btn" aria-label={`${e.title} 빼기`} onClick={() => setConfirmDel(e)}>✕</button>}
                    />
                  ))}
                </FoodList>
              )}
              <QuickAdd onRecord={record} recordLabel={recordLabel} />
            </>
          )}
        </>
      )}

      {mode === "home" && <HomeForm onSave={(d) => record([d])} actionLabel={recordLabel} />}
      {mode === "photo" && <PhotoForm onSave={(list) => record(list)} />}
      {mode === "manual" && <ManualForm onSave={(d) => record([d])} actionLabel={recordLabel} />}
      {confirmDel && (
        <Dialog
          title="기록 삭제"
          actions={
            <>
              <Btn onClick={() => setConfirmDel(null)}>취소</Btn>
              <button className="danger" onClick={() => remove(confirmDel)}>삭제</button>
            </>
          }
        >
          <p>{mealLabel}에 기록한 "{confirmDel.title}"({Math.round(confirmDel.total.kcal).toLocaleString()}kcal)을 삭제할까요?</p>
        </Dialog>
      )}
    </Screen>
  );
}
