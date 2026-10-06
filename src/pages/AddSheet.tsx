import { useState } from "react";
import { db, MEALS, savedKey, sumNutrients, type Entry, type Item, type Meal } from "../db";
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
}

/** 기록 저장 + 다음에 다시 쓰도록 메뉴 저장 */
export async function saveEntry(date: string, meal: Meal, d: Draft, memo?: string) {
  const total = sumNutrients(d.items.map((i) => i.nutrients));
  await db.entries.add({ date, meal, kind: d.kind, title: d.title, place: d.place, items: d.items, total, memo, createdAt: Date.now() });
  const key = savedKey(d.kind, d.place, d.title);
  const prev = await db.saved.get(key);
  await db.saved.put({ key, kind: d.kind, title: d.title, place: d.place, items: d.items, total, uses: (prev?.uses ?? 0) + 1, updatedAt: Date.now(), groupId: prev?.groupId });
}

export default function AddSheet({ date, meal: initialMeal, onClose }: { date: string; meal: Meal; onClose: () => void }) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [mode, setMode] = useState<Mode>("out");
  // 즐겨찾기·세트에서 담은 것 (탭을 오가도 유지)
  const [cart, setCart] = useState<CartItem[]>([]);
  const toggle = (c: CartItem) => setCart((p) => (p.some((x) => x.id === c.id) ? p.filter((x) => x.id !== c.id) : [...p, c]));
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

  return (
    <Sheet title="식단 기록" onClose={onClose}>
      <div className="seg meal-seg">
        {MEALS.map((m) => (
          <button key={m.key} className={meal === m.key ? "on" : ""} onClick={() => setMeal(m.key)}>{m.label}</button>
        ))}
      </div>

      {mode === "manual" ? (
        <>
          <div className="row-between">
            <button className="link" onClick={() => setMode("out")}>← 돌아가기</button>
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
          {mode === "out" && <SearchForm key="out" kind="out" onSave={onSave} />}
          {mode === "home" && <HomeForm onSave={onSave} />}
          {mode === "food" && <SearchForm key="food" kind="food" onSave={onSave} />}
          {mode === "fav" && <FavoritesTab cart={cart} toggle={toggle} />}
          {mode === "sets" && <SetsTab cart={cart} toggle={toggle} />}
          {showCart && (
            <div className="cart-bar">
              <button className={`cart-btn ${count ? "on" : ""}`} onClick={recordCart}>
                <span className="cart-count">{count}</span> {count ? "개 기록하기" : "개 담겼어요"}
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
