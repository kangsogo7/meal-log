// 기록하기 첫 화면: 자주 먹는 것·즐겨찾기 폴더·세트·최근을 카드로. 한 번 누르면 담기, 길게 누르면 양 조절
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, folderEmoji, type SavedFood } from "../db";
import { NutrientLine, Sheet } from "../components/ui";
import { AmountEditor, portionNutrients, storedPortion, type Portion } from "../portion";
import { FolderScreen, FoodEditScreen, savedDraft, servingLine, SetEditScreen, type CartItem } from "./FavoritesTab";
import { SavedFoodEditSheet, SetComposeScreen } from "./FavEditors";

type Source = { kind: "often" } | { kind: "group"; id: number } | { kind: "sets" } | { kind: "recent" };

const LONG_PRESS_MS = 450;

/** 누르면 담기, 길게 누르면 onLong (스크롤하려고 움직이면 취소) */
function usePress(onTap: () => void, onLong: () => void) {
  const timer = useRef<number>(0);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.abs(e.clientX - start.current.x) + Math.abs(e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: () => clearTimeout(timer.current),
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (!fired.current) onTap();
    },
  };
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
                  onTap={() => toggle({ id, drafts: s.entries })}
                  onLong={() => setComposeSet(s.id!)}
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
                  onTap={() => (inCart ? toggle(inCart) : put({ id, drafts: [savedDraft(s, portion)], portion }))}
                  onLong={() => setAmountOf({ food: s, portion })}
                />
              );
            })}
          </div>
          {foods.length > 0 && <p className="muted small quick-hint">한 번 누르면 담기, 길게 누르면 양 조절·수정</p>}
          {group && <button className="link small quick-manage" onClick={() => setManage("foods")}>음식 편집</button>}
        </>
      )}

      {amountOf && (
        <Sheet title={amountOf.food.title} onClose={() => setAmountOf(null)}>
          <div className="form">
            <AmountEditor portion={amountOf.portion} onChange={(p) => setAmountOf({ ...amountOf, portion: p })} />
            <NutrientLine n={portionNutrients(amountOf.portion)} />
            <button className="primary block" onClick={() => {
              const s = amountOf.food;
              put({ id: `fav:${s.key}`, drafts: [savedDraft(s, amountOf.portion)], portion: amountOf.portion });
              setAmountOf(null);
            }}>
              {cart.some((c) => c.id === `fav:${amountOf.food.key}`) ? "이 양으로 변경" : "이 양으로 담기"}
            </button>
            <button className="link small" onClick={() => { setEditFood(amountOf.food); setAmountOf(null); }}>이름·1회 제공량·영양성분 수정</button>
          </div>
        </Sheet>
      )}
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

function FoodCard({ title, sub, kcal, on, badge, onTap, onLong }: {
  title: string; sub: string; kcal: number; on: boolean; badge: string; onTap: () => void; onLong: () => void;
}) {
  const press = usePress(onTap, onLong);
  return (
    <button className={`quick-card ${on ? "on" : ""}`} aria-pressed={on} {...press}>
      {badge && <span className="quick-badge">{badge}</span>}
      <b className="quick-title">{title}</b>
      <span className="muted small quick-sub">{sub}</span>
      <b className="quick-kcal">{kcal.toLocaleString()}<span className="muted"> kcal</span></b>
    </button>
  );
}

function SetCard({ name, sub, kcal, on, onTap, onLong }: { name: string; sub: string; kcal: number; on: boolean; onTap: () => void; onLong: () => void }) {
  const press = usePress(onTap, onLong);
  return (
    <button className={`quick-card ${on ? "on" : ""}`} aria-pressed={on} {...press}>
      {on && <span className="quick-badge">✓</span>}
      <b className="quick-title">{name}</b>
      <span className="muted small quick-sub">{sub}</span>
      <b className="quick-kcal">{kcal.toLocaleString()}<span className="muted"> kcal</span></b>
    </button>
  );
}
