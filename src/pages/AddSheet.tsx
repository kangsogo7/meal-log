import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, KIND_LABEL, MEALS, savedKey, sumNutrients, type Entry, type Item, type Meal, type MealSet, type Nutrients, type SavedFood } from "../db";
import { NutrientLine, Sheet, SwipeRow, Toast } from "../components/ui";
import SearchForm from "./SearchForm";
import HomeForm from "./HomeForm";
import ManualForm from "./ManualForm";
import { createGroup, deleteGroup, FavStar, renameGroup } from "../favorites";

type Mode = "out" | "home" | "food" | "fav" | "manual";
const TABS: { key: Mode; label: string }[] = [
  { key: "out", label: "외식" },
  { key: "home", label: "조리" },
  { key: "food", label: "식품" },
  { key: "fav", label: "즐겨찾기" },
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
  const [toast, setToast] = useState<string | null>(null);

  const onSave = async (d: Draft) => {
    try {
      await saveEntry(date, meal, d);
      onClose();
    } catch (e) {
      alert(`저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

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
          <div className="seg">
            {TABS.map((m) => (
              <button key={m.key} className={mode === m.key ? "on" : ""} onClick={() => setMode(m.key)}>{m.label}</button>
            ))}
          </div>
          <div className="manual-link">
            <button className="link small" onClick={() => setMode("manual")}>직접 입력</button>
          </div>
          {mode === "out" && <SearchForm key="out" kind="out" onSave={onSave} />}
          {mode === "home" && <HomeForm onSave={onSave} />}
          {mode === "food" && <SearchForm key="food" kind="food" onSave={onSave} />}
          {mode === "fav" && (
            <Favorites
              onPickSet={async (set) => {
                try {
                  for (const e of set.entries) await saveEntry(date, meal, e);
                  setToast(`"${set.name}" ${set.entries.length}개 기록했어요`);
                  setTimeout(onClose, 700);
                } catch (e) {
                  alert(`저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              onPick={async (s) => {
                try {
                  await saveEntry(date, meal, { kind: s.kind, title: s.title, place: s.place, items: s.items });
                  setToast(`"${s.title}" 기록했어요`);
                  setTimeout(onClose, 700);
                } catch (e) {
                  alert(`저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
            />
          )}
        </>
      )}
      <Toast message={toast} />
    </Sheet>
  );
}

/** 식사 세트 + 즐겨찾기 그룹 + 최근 먹은 것. 누르면 바로 기록, 왼쪽으로 밀면 삭제 */
function Favorites({ onPick, onPickSet }: { onPick: (s: SavedFood) => void; onPickSet: (s: MealSet) => void }) {
  const [q, setQ] = useState("");
  const groups = useLiveQuery(() => db.groups.orderBy("order").toArray(), [], []);
  const favs = useLiveQuery(() => db.saved.filter((s) => s.groupId != null).toArray(), [], []);
  const sets = useLiveQuery(() => db.sets.orderBy("updatedAt").reverse().toArray(), [], []);
  const match = (s: SavedFood) => !q || `${s.place ?? ""} ${s.title}`.includes(q.trim());
  const shownSets = sets.filter((s) => !q || `${s.name} ${s.entries.map((e) => e.title).join(" ")}`.includes(q.trim()));

  const row = (s: SavedFood) => (
    <li key={s.key}>
      <SwipeRow onTap={() => onPick(s)} onDelete={() => db.saved.delete(s.key)}>
        <div className="fav-row">
          <div>
            <div><span className="tag">{KIND_LABEL[s.kind]}</span>{s.place ? `${s.place} · ` : ""}{s.title}</div>
            <NutrientLine n={s.total as Nutrients} />
          </div>
          <FavStar getDraft={() => s} />
        </div>
      </SwipeRow>
    </li>
  );

  return (
    <div>
      <input placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} />
      {shownSets.length > 0 && (
        <>
          <h3 className="list-title">식사 세트</h3>
          <ul className="pick-list">
            {shownSets.map((s) => (
              <li key={s.id}>
                <SwipeRow onTap={() => onPickSet(s)} onDelete={() => db.sets.delete(s.id!)}>
                  <div><b>{s.name}</b> <span className="muted small">{s.entries.length}개</span></div>
                  <div className="muted small set-items">{s.entries.map((e) => (e.place ? `${e.place} ${e.title}` : e.title)).join(", ")}</div>
                  <NutrientLine n={s.total} />
                </SwipeRow>
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="link small new-group" onClick={() => createGroup()}>+ 새 그룹</button>
      {groups.map((g, gi) => {
        const items = favs.filter((s) => s.groupId === g.id && match(s));
        if (q && items.length === 0) return null;
        return (
          <section key={g.id} className="fav-group">
            <div className="group-head">
              <h3 className="list-title">{g.name}</h3>
              <div className="group-actions">
                <button className="link small" onClick={() => renameGroup(g.id!, g.name)}>이름 변경</button>
                {gi > 0 && <button className="link small danger-link" onClick={() => deleteGroup(g.id!, g.name)}>삭제</button>}
              </div>
            </div>
            {items.length === 0 ? <p className="muted small">☆를 눌러 추가</p> : <ul className="pick-list">{items.map(row)}</ul>}
          </section>
        );
      })}
    </div>
  );
}
