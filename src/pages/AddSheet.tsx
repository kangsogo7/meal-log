import { useEffect, useState } from "react";
import { baseServing, db, MEALS, savedKey, sumNutrients, type Entry, type Item, type Meal } from "../db";
import { flash, Sheet } from "../components/ui";
import SearchForm from "./SearchForm";
import HomeForm from "./HomeForm";
import ManualForm from "./ManualForm";
import { FavoritesTab, SetsTab, type CartItem } from "./FavoritesTab";

type Mode = "out" | "home" | "food" | "fav" | "sets" | "manual";
const TABS: { key: Mode; label: string }[] = [
  { key: "out", label: "외식" },
  { key: "home", label: "조리" },
  { key: "food", label: "식품" },
  { key: "fav", label: "즐겨찾기" },
  { key: "sets", label: "세트" },
];

export interface Draft {
  kind: Entry["kind"];
  title: string;
  place?: string;
  items: Item[];
  k?: number; // 양 조절 배수
}

/** 기록 저장 + 다음에 다시 쓰도록 메뉴 저장 */
export async function saveEntry(date: string, meal: Meal, d: Draft, memo?: string) {
  const total = sumNutrients(d.items.map((i) => i.nutrients));
  await db.entries.add({ date, meal, kind: d.kind, title: d.title, place: d.place, items: d.items, total, k: d.k, memo, createdAt: Date.now() });
  const key = savedKey(d.kind, d.place, d.title);
  const prev = await db.saved.get(key);
  // 즐겨찾기·최근 메뉴에는 양 조절 전 1회 제공량으로
  const base = baseServing(d.items, d.k);
  await db.saved.put({ key, kind: d.kind, title: d.title, place: d.place, items: base, total: sumNutrients(base.map((i) => i.nutrients)), uses: (prev?.uses ?? 0) + 1, updatedAt: Date.now(), groupId: prev?.groupId });
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

export default function AddSheet({ date, meal: initialMeal, onClose: close, restore }: { date: string; meal: Meal; onClose: () => void; restore?: AddDraft | null }) {
  const onClose = () => {
    saveAddDraft(null);
    close();
  };
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [mode, setMode] = useState<Mode>(restore?.mode ?? "fav");
  const [query, setQuery] = useState(restore?.query ?? "");
  useEffect(() => saveAddDraft({ date, meal, mode, query, at: Date.now() }), [date, meal, mode, query]);
  // 즐겨찾기·세트에서 담은 것 (탭을 오가도 유지)
  const [cart, setCart] = useState<CartItem[]>([]);
  const toggle = (c: CartItem) => setCart((p) => (p.some((x) => x.id === c.id) ? p.filter((x) => x.id !== c.id) : [...p, c]));
  // 담기 또는 담은 것의 양 변경
  const put = (c: CartItem) => setCart((p) => (p.some((x) => x.id === c.id) ? p.map((x) => (x.id === c.id ? c : x)) : [...p, c]));
  const count = cart.reduce((n, c) => n + c.drafts.length, 0);

  const onSave = async (d: Draft) => {
    try {
      await saveEntry(date, meal, d);
      onClose();
    } catch (e) {
      alert(`저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const recordCart = async () => {
    if (!count) return;
    try {
      for (const c of cart) for (const d of c.drafts) await saveEntry(date, meal, d);
      flash(`${count}개 기록했어요`);
      onClose();
    } catch (e) {
      alert(`저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const showCart = mode === "fav" || mode === "sets";
  // 담은 게 있으면 창 맨 아래에 고정 (목록 길이와 상관없이 항상 화면 하단)
  const cartFooter =
    showCart && count > 0 ? (
      <button className="cart-btn on" onClick={recordCart}>
        <span className="cart-count">{count}</span> 개 기록하기
      </button>
    ) : undefined;

  return (
    <Sheet title="식단 기록" onClose={onClose} tall footer={cartFooter}>
      <div className="seg meal-seg">
        {MEALS.map((m) => (
          <button key={m.key} className={meal === m.key ? "on" : ""} onClick={() => setMeal(m.key)}>{m.label}</button>
        ))}
      </div>

      {mode === "manual" ? (
        <>
          <div className="row-between">
            <button className="link" onClick={() => setMode("fav")}>← 돌아가기</button>
            <b>직접 입력</b>
          </div>
          <ManualForm onSave={onSave} />
        </>
      ) : (
        <>
          <div className="seg tabs5">
            {TABS.map((m) => (
              <button key={m.key} className={mode === m.key ? "on" : ""} onClick={() => setMode(m.key)}>{m.label}</button>
            ))}
          </div>
          {!showCart && (
            <div className="manual-link">
              <button className="link small" onClick={() => setMode("manual")}>직접 입력</button>
            </div>
          )}
          {mode === "out" && <SearchForm key="out" kind="out" onSave={onSave} initialQuery={restore?.mode === "out" ? restore.query : ""} onQueryChange={setQuery} />}
          {mode === "home" && <HomeForm onSave={onSave} />}
          {mode === "food" && <SearchForm key="food" kind="food" onSave={onSave} initialQuery={restore?.mode === "food" ? restore.query : ""} onQueryChange={setQuery} />}
          {mode === "fav" && <FavoritesTab cart={cart} toggle={toggle} put={put} />}
          {mode === "sets" && <SetsTab cart={cart} toggle={toggle} />}
        </>
      )}
    </Sheet>
  );
}
