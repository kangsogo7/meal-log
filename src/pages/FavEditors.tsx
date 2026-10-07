// 즐겨찾기 음식 수정 / 식사 세트 구성 수정
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, r1, savedKey, sumNutrients, type MealSet, type Nutrients, type SavedFood } from "../db";
import { BackIcon, flash, NumInput, NutrientEditor, NutrientLine, Screen, Sheet } from "../components/ui";
import { AmountEditor, portionItems, portionNutrients, storedPortion, type Portion } from "../portion";

// ---------------------------------------------------------------------------
// 즐겨찾기 음식 수정: 이름·상호·1회 제공량·영양성분
// ---------------------------------------------------------------------------
export function SavedFoodEditSheet({ food, onClose }: { food: SavedFood; onClose: () => void }) {
  const single = food.items.length === 1;
  const [title, setTitle] = useState(food.title);
  const [place, setPlace] = useState(food.place ?? "");
  const [grams, setGrams] = useState<number | null>(single ? food.items[0].grams : null);
  const [amountText, setAmountText] = useState(food.items[0]?.amountText ?? "");
  const [base, setBase] = useState<Nutrients>(food.total);

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    const p = place.trim() || undefined;
    const items = single
      ? [{
          ...food.items[0],
          name: t,
          grams: grams ? r1(grams) : null,
          amountText: grams ? `${r1(grams)}g` : amountText,
          nutrients: base,
        }]
      : food.items;
    const key = savedKey(food.kind, p, t);
    try {
      await db.transaction("rw", db.saved, async () => {
        if (key !== food.key) await db.saved.delete(food.key);
        await db.saved.put({ ...food, key, title: t, place: p, items, total: sumNutrients(items.map((i) => i.nutrients)) });
      });
      flash("수정했어요");
      onClose();
    } catch (err) {
      alert(`저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Sheet
      title="음식 수정"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>취소</button>
          <button className="primary" onClick={save} disabled={!title.trim()}>저장</button>
        </>
      }
    >
      <div className="form">
        <label>이름
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {(food.kind === "out" || food.kind === "food") && (
          <label>{food.kind === "out" ? "가게 이름" : "제조사"}
            <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="선택" />
          </label>
        )}
        {single ? (
          <>
            {food.items[0]?.grams ? (
              <label>1회 제공량 (g)
                <NumInput value={grams} onChange={setGrams} decimals={1} />
              </label>
            ) : (
              <label>1회 제공량
                <input value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="선택 · 예: 1스쿱" />
              </label>
            )}
            <p className="label">1회 제공량 영양성분</p>
            <NutrientEditor n={base} onChange={setBase} />
          </>
        ) : (
          <ul className="mini-list">
            {food.items.map((i, idx) => (
              <li key={idx}>
                <span>{i.name} {i.grams ? `${Math.round(i.grams)}g` : i.amountText}</span>
                <NutrientLine n={i.nutrients} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 식사 세트 구성 수정: 이름 · 음식 빼기/추가 · 음식별 양
// ---------------------------------------------------------------------------
type SetEntry = MealSet["entries"][number];
const entryPortion = (e: SetEntry) => storedPortion({ ...e, total: sumNutrients(e.items.map((i) => i.nutrients)) });

export function SetComposeScreen({ set, onClose }: { set: MealSet; onClose: () => void }) {
  const [name, setName] = useState(set.name);
  const [rows, setRows] = useState(() => set.entries.map((e, i) => ({ id: i, e, portion: entryPortion(e) })));
  const [picking, setPicking] = useState(false);
  const nextId = useRef(set.entries.length);
  const total = sumNutrients(rows.map((r) => portionNutrients(r.portion)));
  const valid = !!name.trim() && rows.length > 0;

  const save = async () => {
    if (!valid) return;
    try {
      await db.sets.update(set.id!, {
        name: name.trim(),
        entries: rows.map((r): SetEntry => ({ ...r.e, items: portionItems(r.e, r.portion), k: r.portion.k })),
        total,
        updatedAt: Date.now(),
      });
      flash("세트를 수정했어요");
      onClose();
    } catch (err) {
      alert(`저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const add = (s: SavedFood) => {
    const e: SetEntry = { kind: s.kind, title: s.title, place: s.place, items: s.items };
    setRows((p) => [...p, { id: nextId.current++, e, portion: entryPortion(e) }]);
    flash(`${s.title} 추가했어요`);
  };
  const setPortion = (id: number, portion: Portion) => setRows((p) => p.map((x) => (x.id === id ? { ...x, portion } : x)));

  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title="세트 수정"
      footer={<button className="primary block big" onClick={save} disabled={!valid}>저장</button>}
    >
      <div className="form">
        <label>세트 이름
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="list-head">
        <span className="muted">음식 {rows.length}개 · {Math.round(total.kcal)}kcal</span>
        <button className="text-btn" onClick={() => setPicking(true)}>＋ 음식 추가</button>
      </div>
      {rows.length === 0 ? (
        <p className="muted small empty">음식을 추가해 주세요</p>
      ) : (
        <ul className="food-cards">
          {rows.map((r) => (
            <li key={r.id} className="food-card stack">
              <div className="fc-row">
                <div className="fc-main">
                  <div className="fc-name">{r.e.title}</div>
                  <div className="fc-sub">
                    <span className="fc-serving muted">{r.e.place}</span>
                    <span className="muted fc-kcal">{Math.round(portionNutrients(r.portion).kcal)}kcal</span>
                  </div>
                </div>
                <button className="del-dot" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))} aria-label={`${r.e.title} 빼기`}>✕</button>
              </div>
              <div className="fc-amount">
                <AmountEditor portion={r.portion} onChange={(p) => setPortion(r.id, p)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {picking && <SavedFoodPicker onPick={add} onClose={() => setPicking(false)} />}
    </Screen>
  );
}

/** 세트에 넣을 음식 고르기: 즐겨찾기(★)가 먼저, 그다음 최근 기록한 음식 */
function SavedFoodPicker({ onPick, onClose }: { onPick: (s: SavedFood) => void; onClose: () => void }) {
  const all = useLiveQuery(() => db.saved.toArray(), [], []);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = all
    .filter((s) => !query || `${s.place ?? ""} ${s.title}`.toLowerCase().includes(query))
    .sort((a, b) => Number(b.groupId != null) - Number(a.groupId != null) || b.uses - a.uses || b.updatedAt - a.updatedAt);
  return (
    <Sheet title="음식 추가" onClose={onClose} tall>
      <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="즐겨찾기·최근 음식 검색" />
      <ul className="mini-list">
        {list.map((s) => (
          <li key={s.key} className="pick-row" onClick={() => onPick(s)}>
            <span>{s.groupId != null && "★ "}{s.place && <b>{s.place} </b>}{s.title}</span>
            <span className="muted">{Math.round(s.total.kcal)}kcal ＋</span>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="muted small">음식이 없어요</p>}
    </Sheet>
  );
}
