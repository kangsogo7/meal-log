// 즐겨찾기 음식 수정 / 식사 세트 구성 수정
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, r1, savedKey, sumNutrients, ZERO, type Item, type MealSet, type Nutrients, type SavedFood } from "../db";
import { BackIcon, flash, itemParts, NumInput, NutrientEditor, NutrientLine, PartsList, Screen, FullScreen, TextInput } from "../components/ui";
import ItemEditScreen from "../components/ItemEditScreen";
import { AmountEditor, portionItems, portionNutrients, storedPortion, type Portion } from "../portion";

// ---------------------------------------------------------------------------
// 음식 수정 화면 (자주 먹는 것·기록 수정 공통): 이름·상호·1회 제공량·영양성분, 재료가 여럿이면 재료 목록
// ---------------------------------------------------------------------------
export type FoodEdit = { title: string; place?: string; items: Item[] };

export function FoodEditScreen({ food, saveLabel = "저장", amountLabel = "1회 제공량", onSave, onClose }: {
  food: { kind: SavedFood["kind"]; title: string; place?: string; items: Item[]; total: Nutrients };
  saveLabel?: string;
  /** 숫자가 어떤 양 기준인지 (기록은 먹은 양) */
  amountLabel?: string;
  onSave: (edit: FoodEdit) => void;
  onClose: () => void;
}) {
  const single = food.items.length === 1;
  const [title, setTitle] = useState(food.title);
  const [place, setPlace] = useState(food.place ?? "");
  const [grams, setGrams] = useState<number | null>(single ? food.items[0].grams : null);
  const [amountText, setAmountText] = useState(food.items[0]?.amountText ?? "");
  const [base0] = useState<Nutrients>(food.total);
  const [base, setBase] = useState(base0);
  // 재료 여러 개짜리: 재료마다 이름·양·영양성분 수정, 빼기, 추가
  const [ings, setIngs] = useState<Item[]>(food.items);

  const save = () => {
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
          // 영양성분을 직접 고치면 출처는 "직접 입력"
          ...(base !== base0 ? { source: "manual" as const, via: undefined } : {}),
        }]
      : ings.filter((i) => i.name.trim()).map((i) => ({ ...i, name: i.name.trim() }));
    if (!items.length) return alert("재료가 하나 이상 있어야 해요.");
    onSave({ title: t, place: p, items });
  };

  return (
    <FullScreen
      title="음식 수정"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>취소</button>
          <button className="primary" onClick={save} disabled={!title.trim()}>{saveLabel}</button>
        </>
      }
    >
      <div className="form">
        <label>이름
          <TextInput value={title} onChange={setTitle} />
        </label>
        {(food.kind === "out" || food.kind === "food") && (
          <label>{food.kind === "out" ? "가게 이름" : "제조사"}
            <TextInput value={place} onChange={setPlace} placeholder="선택" />
          </label>
        )}
        {single ? (
          <>
            {food.items[0]?.grams ? (
              <label>{amountLabel} (g)
                <NumInput value={grams} onChange={setGrams} decimals={1} />
              </label>
            ) : (
              <label>{amountLabel}
                <TextInput value={amountText} onChange={setAmountText} placeholder="선택 · 예: 1스쿱" />
              </label>
            )}
            <p className="label">{amountLabel} 영양성분</p>
            <NutrientEditor n={base} onChange={setBase} />
          </>
        ) : (
          <IngredientEditor items={ings} onChange={setIngs} />
        )}
      </div>
    </FullScreen>
  );
}

/** 저장된 음식(즐겨찾기·자주 먹는 것) 고치기: 저장을 누르면 바로 반영 */
export function SavedFoodEditSheet({ food, onClose }: { food: SavedFood; onClose: () => void }) {
  const save = async ({ title, place, items }: FoodEdit) => {
    const key = savedKey(food.kind, place, title);
    try {
      await db.transaction("rw", db.saved, async () => {
        if (key !== food.key) await db.saved.delete(food.key);
        await db.saved.put({ ...food, key, title, place, items, total: sumNutrients(items.map((i) => i.nutrients)) });
      });
      flash("수정했어요");
      onClose();
    } catch (err) {
      alert(`저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return <FoodEditScreen food={food} onSave={save} onClose={onClose} />;
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
          <TextInput value={name} onChange={setName} />
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
    <FullScreen title="음식 추가" onClose={onClose} tall>
      <TextInput className="search-input" value={q} onChange={setQ} placeholder="즐겨찾기·최근 음식 검색" />
      <ul className="mini-list">
        {list.map((s) => (
          <li key={s.key} className="pick-row" onClick={() => onPick(s)}>
            <span>{s.groupId != null && "★ "}{s.place && <b>{s.place} </b>}{s.title}</span>
            <span className="muted">{Math.round(s.total.kcal)}kcal ＋</span>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="muted small">음식이 없어요</p>}
    </FullScreen>
  );
}

// ---------------------------------------------------------------------------
// 재료 편집: 이름 · 양(g을 바꾸면 영양성분도 같은 비율로) · 영양성분 · 빼기 · 추가
// ---------------------------------------------------------------------------
function IngredientEditor({ items, onChange }: { items: Item[]; onChange: (items: Item[]) => void }) {
  const [open, setOpen] = useState<number | "new" | null>(null);
  const total = sumNutrients(items.map((i) => i.nutrients));
  return (
    <>
      <div className="row-between ing-head">
        <p className="muted small">재료 {items.length}개 · 합계</p>
        <NutrientLine n={total} />
      </div>
      <PartsList parts={itemParts(items)} onPick={setOpen} />
      <button className="block" onClick={() => setOpen("new")}>+ 재료 추가</button>
      {open === "new" && (
        <ItemEditScreen
          title="재료 추가"
          item={{ name: "", amountText: "", grams: null, source: "manual", nutrients: { ...ZERO } }}
          onDone={(it) => { onChange([...items, it]); setOpen(null); }}
          onClose={() => setOpen(null)}
        />
      )}
      {typeof open === "number" && items[open] && (
        <ItemEditScreen
          item={items[open]}
          onDone={(it) => { onChange(items.map((x, j) => (j === open ? it : x))); setOpen(null); }}
          onRemove={items.length > 1 ? () => { onChange(items.filter((_, j) => j !== open)); setOpen(null); } : undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
