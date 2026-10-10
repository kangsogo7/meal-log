import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { baseServing, db, MEALS, savedKey, sumNutrients, type Entry, type Item, type Meal } from "../db";
import { flash, Sheet } from "../components/ui";
import SearchForm from "./SearchForm";
import HomeForm from "./HomeForm";
import ManualForm from "./ManualForm";
import type { CartItem } from "./FavoritesTab";
import QuickAdd from "./QuickAdd";
import { useTargets } from "../hooks";

/** quick: 자주 먹는 것 카드 / search: 외식·식품 검색 / home: 재료로 직접(조리) / manual: 숫자로 입력 */
type Mode = "quick" | "search" | "home" | "manual";
type Kind = "out" | "food";

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
export interface AddDraft { date: string; meal: Meal; mode: Mode; kind?: Kind; query: string; at: number }
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
  // 예전 형식(외식/식품/즐겨찾기 탭)으로 저장된 쓰던 창도 이어서 열기
  const old = restore?.mode as string | undefined;
  const [mode, setMode] = useState<Mode>(old === "out" || old === "food" ? "search" : old === "home" || old === "manual" || old === "search" ? (old as Mode) : "quick");
  const [kind, setKind] = useState<Kind>(old === "food" ? "food" : restore?.kind ?? "out");
  const [query, setQuery] = useState(restore?.query ?? "");
  useEffect(() => saveAddDraft({ date, meal, mode, kind, query, at: Date.now() }), [date, meal, mode, kind, query]);
  const { target } = useTargets(date);
  const dayTotal = useLiveQuery(async () => sumNutrients((await db.entries.where("date").equals(date).toArray()).map((e) => e.total)).kcal, [date], 0);

  // 담은 것 (카드·검색·직접 입력에서 담은 걸 모아 한 번에 기록)
  const [cart, setCart] = useState<CartItem[]>([]);
  const toggle = (c: CartItem) => setCart((p) => (p.some((x) => x.id === c.id) ? p.filter((x) => x.id !== c.id) : [...p, c]));
  // 담기 또는 담은 것의 양 변경
  const put = (c: CartItem) => setCart((p) => (p.some((x) => x.id === c.id) ? p.map((x) => (x.id === c.id ? c : x)) : [...p, c]));
  const count = cart.reduce((n, c) => n + c.drafts.length, 0);
  const cartKcal = cart.reduce((n, c) => n + c.drafts.reduce((m, d) => m + sumNutrients(d.items.map((i) => i.nutrients)).kcal, 0), 0);

  /** 검색·조리·직접 입력에서 고른 음식은 담고 카드 화면으로 */
  const addDraft = (d: Draft) => {
    put({ id: `draft:${Date.now()}`, drafts: [d] });
    flash(`${d.title} 담았어요`);
    setQuery("");
    setMode("quick");
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

  const after = target ? Math.round(target.kcal - dayTotal - cartKcal) : null;
  const cartFooter =
    count > 0 ? (
      <div className="cart-foot">
        <div className="cart-sum">
          <b>{count}개 · {Math.round(cartKcal).toLocaleString()}kcal</b>
          {after != null && <span className="muted small">{after >= 0 ? `기록하면 ${after.toLocaleString()}kcal 남아요` : `기록하면 ${(-after).toLocaleString()}kcal 넘어요`}</span>}
        </div>
        <button className="primary cart-go" onClick={recordCart}>기록하기</button>
      </div>
    ) : undefined;

  const back = <button className="link" onClick={() => setMode("quick")}>← 자주 먹는 것</button>;
  const extras = cart.filter((c) => c.id.startsWith("draft:"));

  return (
    <Sheet title="식단 기록" onClose={onClose} tall footer={cartFooter}>
      <div className="seg meal-seg">
        {MEALS.map((m) => (
          <button key={m.key} className={meal === m.key ? "on" : ""} onClick={() => setMeal(m.key)}>{m.label}</button>
        ))}
      </div>

      {mode === "quick" && (
        <>
          <button className="search-fake" onClick={() => setMode("search")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            음식 검색 (가게·메뉴·식품)
          </button>
          <div className="quick-modes">
            <button onClick={() => setMode("home")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 11h14v1a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6v-1Z" /><path d="M17 12h4" /><path d="M8 7c0-1 1-1 1-2M12 7c0-1 1-1 1-2" /></svg>
              <span><b>재료로 직접</b><small>집밥·요리 재료 입력</small></span>
            </button>
            <button onClick={() => setMode("manual")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" /></svg>
              <span><b>숫자로 입력</b><small>칼로리·탄단지 직접</small></span>
            </button>
          </div>
          {extras.length > 0 && (
            <div className="cart-extras">
              {extras.map((c) => (
                <span key={c.id} className="cart-chip">
                  {c.drafts[0].title}
                  <button aria-label={`${c.drafts[0].title} 빼기`} onClick={() => toggle(c)}>✕</button>
                </span>
              ))}
            </div>
          )}
          <QuickAdd cart={cart} toggle={toggle} put={put} />
        </>
      )}

      {mode === "search" && (
        <>
          <div className="row-between search-head">
            {back}
            <div className="seg mini">
              <button className={kind === "out" ? "on" : ""} onClick={() => setKind("out")}>외식</button>
              <button className={kind === "food" ? "on" : ""} onClick={() => setKind("food")}>식품</button>
            </div>
          </div>
          <SearchForm
            key={kind}
            kind={kind}
            onSave={addDraft}
            actionLabel="담기"
            autoFocus
            initialQuery={query}
            onQueryChange={setQuery}
          />
        </>
      )}

      {mode === "home" && (
        <>
          <div className="row-between search-head">{back}<b>재료로 직접</b></div>
          <HomeForm onSave={addDraft} actionLabel="담기" />
        </>
      )}

      {mode === "manual" && (
        <>
          <div className="row-between search-head">{back}<b>숫자로 직접 입력</b></div>
          <ManualForm onSave={addDraft} actionLabel="담기" />
        </>
      )}
    </Sheet>
  );
}
