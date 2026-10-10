// 기록하기 첫 화면: 자주 먹는 것·즐겨찾기 폴더·세트·최근을 카드로. 카드를 누르면 양·영양성분을 보고 담기, 모서리 +는 바로 담기
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, folderEmoji, sumNutrients, type MealSet, type SavedFood } from "../db";
import { flash, NutrientGrid, Sheet } from "../components/ui";
import { AmountEditor, portionItems, portionNutrients, storedPortion, type Portion } from "../portion";
import { shareFood, type SharedFood } from "../foodShare";
import { FolderScreen, FoodEditScreen, savedDraft, servingLine, SetEditScreen, type CartItem } from "./FavoritesTab";
import { SavedFoodEditSheet, SetComposeScreen } from "./FavEditors";

type Source = { kind: "often" } | { kind: "group"; id: number } | { kind: "sets" } | { kind: "recent" };

/** 음식을 링크로 보내기 (받은 사람은 링크를 누르면 바로 기록) */
export async function shareOut(f: SharedFood) {
  const r = await shareFood(f);
  if (r === "copied") flash("공유 링크를 복사했어요");
}

export default function QuickAdd({ cart, toggle, put }: { cart: CartItem[]; toggle: (c: CartItem) => void; put: (c: CartItem) => void }) {
  const groups = useLiveQuery(() => db.groups.orderBy("order").toArray(), [], []);
  const saved = useLiveQuery(() => db.saved.toArray(), [], []);
  const sets = useLiveQuery(() => db.sets.orderBy("updatedAt").reverse().toArray(), [], []);
  const [src, setSrc] = useState<Source>({ kind: "often" });
  const [amountOf, setAmountOf] = useState<{ food: SavedFood; portion: Portion } | null>(null);
  const [manage, setManage] = useState<"" | "folders" | "foods" | "sets">("");
  const [editFood, setEditFood] = useState<SavedFood | null>(null);
  const [composeSet, setComposeSet] = useState<number | null>(null);
  const [openSet, setOpenSet] = useState<MealSet | null>(null);

  const foods: SavedFood[] =
    src.kind === "often"
      ? saved.filter((s) => s.uses > 0).sort((a, b) => b.uses - a.uses || b.updatedAt - a.updatedAt).slice(0, 30)
      : src.kind === "recent"
        ? [...saved].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30)
        : src.kind === "group"
          ? saved.filter((s) => s.groupId === src.id).sort((a, b) => b.uses - a.uses || b.updatedAt - a.updatedAt)
          : [];
  const group = src.kind === "group" ? groups.find((g) => g.id === src.id) : undefined;
  const isOn = (k: Source["kind"], id?: number) => src.kind === k && (k !== "group" || (src as { id: number }).id === id);

  return (
    <div className="quick">
      <div className="quick-chips" role="tablist" aria-label="음식 모음">
        <button role="tab" aria-selected={isOn("often")} className={isOn("often") ? "on" : ""} onClick={() => setSrc({ kind: "often" })}>자주 먹는 것</button>
        {groups.map((g) => (
          <button role="tab" key={g.id} aria-selected={isOn("group", g.id)} className={isOn("group", g.id) ? "on" : ""} onClick={() => setSrc({ kind: "group", id: g.id! })}>
            {folderEmoji(g)} {g.name}
          </button>
        ))}
        <button role="tab" aria-selected={isOn("sets")} className={isOn("sets") ? "on" : ""} onClick={() => setSrc({ kind: "sets" })}>세트</button>
        <button role="tab" aria-selected={isOn("recent")} className={isOn("recent") ? "on" : ""} onClick={() => setSrc({ kind: "recent" })}>최근</button>
        <button className="chip-manage" onClick={() => setManage("folders")} aria-label="폴더 관리">＋</button>
      </div>

      {src.kind === "sets" ? (
        <>
          {sets.length === 0 && <p className="muted small quick-empty">식단 화면에서 끼니를 눌러 "식사 세트로 저장"하면 여기에 생겨요</p>}
          <div className="quick-grid">
            {sets.map((s) => {
              const id = `set:${s.id}`;
              const on = cart.some((c) => c.id === id);
              return (
                <SetCard
                  key={s.id}
                  name={s.name}
                  sub={`${s.entries.length}개 · ${s.entries.map((e) => e.title).join(", ")}`}
                  kcal={Math.round(s.total.kcal)}
                  on={on}
                  onOpen={() => setOpenSet(s)}
                  onQuick={() => toggle({ id, drafts: s.entries })}
                />
              );
            })}
          </div>
          {sets.length > 0 && <button className="link small quick-manage" onClick={() => setManage("sets")}>세트 편집</button>}
        </>
      ) : (
        <>
          {foods.length === 0 && (
            <p className="muted small quick-empty">
              {src.kind === "group" ? "검색 결과나 기록 옆의 ☆를 눌러 이 폴더에 담아 보세요" : "아직 기록한 음식이 없어요. 위 검색칸에서 찾아 기록해 보세요"}
            </p>
          )}
          <div className="quick-grid">
            {foods.map((s) => {
              const id = `fav:${s.key}`;
              const inCart = cart.find((c) => c.id === id);
              const portion = inCart?.portion ?? storedPortion(s);
              const { place, amount } = servingLine(s);
              return (
                <FoodCard
                  key={s.key}
                  title={s.title}
                  sub={[place, amount, s.uses ? `${s.uses}회` : ""].filter(Boolean).join(" · ")}
                  kcal={Math.round(portionNutrients(portion).kcal)}
                  on={!!inCart}
                  badge={inCart && portion.k !== 1 ? `×${(Math.round(portion.k * 10) / 10).toFixed(1)}` : inCart ? "✓" : ""}
                  onOpen={() => setAmountOf({ food: s, portion })}
                  onQuick={() => (inCart ? toggle(inCart) : put({ id, drafts: [savedDraft(s, portion)], portion }))}
                />
              );
            })}
          </div>
          {foods.length > 0 && <p className="muted small quick-hint">카드를 누르면 양을 정해 담고, 모서리 +는 바로 담아요</p>}
          {group && <button className="link small quick-manage" onClick={() => setManage("foods")}>음식 편집</button>}
        </>
      )}

      {amountOf && (
        <Sheet title={amountOf.food.title} onClose={() => setAmountOf(null)}>
          <div className="form food-detail">
            <NutrientGrid n={portionNutrients(amountOf.portion)} />
            <AmountEditor portion={amountOf.portion} onChange={(p) => setAmountOf({ ...amountOf, portion: p })} />
            <button className="primary block big" onClick={() => {
              const s = amountOf.food;
              put({ id: `fav:${s.key}`, drafts: [savedDraft(s, amountOf.portion)], portion: amountOf.portion });
              setAmountOf(null);
            }}>
              {cart.some((c) => c.id === `fav:${amountOf.food.key}`) ? "이 양으로 변경" : "이 양으로 담기"}
            </button>
            <div className="row-between detail-links">
              <button className="text-btn muted" onClick={() => { setEditFood(amountOf.food); setAmountOf(null); }}>음식 정보 수정</button>
              <button className="text-btn muted" onClick={() => shareOut({ kind: amountOf.food.kind, title: amountOf.food.title, place: amountOf.food.place, items: portionItems(amountOf.food, amountOf.portion), k: amountOf.portion.k })}>공유</button>
              {cart.some((c) => c.id === `fav:${amountOf.food.key}`) && (
                <button className="text-btn danger-text" onClick={() => { toggle(cart.find((c) => c.id === `fav:${amountOf.food.key}`)!); setAmountOf(null); }}>담은 것 빼기</button>
              )}
            </div>
          </div>
        </Sheet>
      )}
      {openSet && (() => {
        const id = `set:${openSet.id}`;
        const on = cart.some((c) => c.id === id);
        return (
          <Sheet title={openSet.name} onClose={() => setOpenSet(null)}>
            <div className="form food-detail">
              <NutrientGrid n={openSet.total} />
              <ul className="mini-list">
                {openSet.entries.map((e, i) => (
                  <li key={i}><span>{e.place && <b>{e.place} </b>}{e.title}</span><span className="muted">{Math.round(sumNutrients(e.items.map((x) => x.nutrients)).kcal)}kcal</span></li>
                ))}
              </ul>
              <button className="primary block big" onClick={() => { if (!on) toggle({ id, drafts: openSet.entries }); setOpenSet(null); }}>{on ? "담겨 있어요" : "세트 담기"}</button>
              <div className="row-between detail-links">
                <button className="text-btn muted" onClick={() => { setComposeSet(openSet.id!); setOpenSet(null); }}>구성 수정</button>
                {on && <button className="text-btn danger-text" onClick={() => { toggle({ id, drafts: openSet.entries }); setOpenSet(null); }}>담은 것 빼기</button>}
              </div>
            </div>
          </Sheet>
        );
      })()}
      {editFood && <SavedFoodEditSheet food={editFood} onClose={() => setEditFood(null)} />}
      {manage === "folders" && (
        <FolderScreen onClose={() => setManage("")} onOpen={(id) => { setSrc({ kind: "group", id }); setManage(""); }} />
      )}
      {manage === "foods" && group && <FoodEditScreen group={group} onClose={() => setManage("")} />}
      {manage === "sets" && <SetEditScreen sets={sets} onClose={() => setManage("")} />}
      {composeSet != null && sets.find((s) => s.id === composeSet) && (
        <SetComposeScreen set={sets.find((s) => s.id === composeSet)!} onClose={() => setComposeSet(null)} />
      )}
    </div>
  );
}

/** 카드: 누르면 상세(양·영양성분), 모서리 +는 바로 담기/빼기 */
function FoodCard({ title, sub, kcal, on, badge, onOpen, onQuick }: {
  title: string; sub: string; kcal: number; on: boolean; badge: string; onOpen: () => void; onQuick: () => void;
}) {
  return (
    <div className={`quick-card ${on ? "on" : ""}`}>
      <button className="quick-open" onClick={onOpen} aria-label={`${title} 양 정하기`}>
        <b className="quick-title">{title}</b>
        <span className="muted small quick-sub">{sub}</span>
        <b className="quick-kcal">{kcal.toLocaleString()}<span className="muted"> kcal</span></b>
      </button>
      <button className={`quick-add ${on ? "on" : ""}`} onClick={onQuick} aria-pressed={on} aria-label={on ? `${title} 빼기` : `${title} 바로 담기`}>
        {on ? badge || "✓" : "+"}
      </button>
    </div>
  );
}

function SetCard({ name, sub, kcal, on, onOpen, onQuick }: { name: string; sub: string; kcal: number; on: boolean; onOpen: () => void; onQuick: () => void }) {
  return <FoodCard title={name} sub={sub} kcal={kcal} on={on} badge="✓" onOpen={onOpen} onQuick={onQuick} />;
}
