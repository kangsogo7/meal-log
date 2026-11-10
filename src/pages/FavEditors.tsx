// 즐겨찾기 음식 수정 / 식사 세트 구성 수정
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, r1, savedKey, sumNutrients, ZERO, type Item, type MealSet, type Nutrients, type SavedFood } from "../db";
import { BackIcon, Btn, BtnRow, flash, FoodList, FoodRow, itemParts, macroLine, NutrientLine, PartsList, Screen, Sheet, FullScreen, TextInput } from "../components/ui";
import ItemEditScreen from "../components/ItemEditScreen";
import { FoodFields } from "../components/FoodFields";
import { AmountEditor, portionItems, portionNutrients, portionText, storedPortion, type Portion } from "../portion";

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
        <BtnRow>
          <Btn onClick={onClose}>취소</Btn>
          <Btn kind="primary" onClick={save} disabled={!title.trim()}>{saveLabel}</Btn>
        </BtnRow>
      }
    >
      <div className="form">
        {single ? (
          <FoodFields
            title={title}
            onTitle={setTitle}
            place={place}
            onPlace={food.kind === "out" ? setPlace : undefined}
            grams={grams}
            onGrams={food.items[0]?.grams ? setGrams : undefined}
            amountText={amountText}
            onAmountText={setAmountText}
            amountLabel={amountLabel}
            n={base}
            onN={setBase}
          />
        ) : (
          <>
            <label>음식 이름
              <TextInput value={title} onChange={setTitle} />
            </label>
            {food.kind === "out" && (
              <label>가게 이름
                <TextInput value={place} onChange={setPlace} placeholder="선택" />
              </label>
            )}
            <IngredientEditor items={ings} onChange={setIngs} />
          </>
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
  const [amountOf, setAmountOf] = useState<number | null>(null);
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
  };
  const setPortion = (id: number, portion: Portion) => setRows((p) => p.map((x) => (x.id === id ? { ...x, portion } : x)));

  const editing = rows.find((r) => r.id === amountOf);

  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title="세트 수정"
      footer={<Btn kind="primary" className="foot-full" onClick={save} disabled={!valid}>저장</Btn>}
    >
      <div className="form">
        <TextInput value={name} onChange={setName} aria-label="세트 이름" placeholder="세트 이름" />
        <div className="row-between muted small"><span>음식 {rows.length}개</span><span>합계 {Math.round(total.kcal).toLocaleString()}kcal</span></div>
      </div>
      <FoodList>
        {rows.map((r) => (
          <FoodRow
            key={r.id}
            title={r.e.title}
            place={r.e.place}
            sub={portionText(r.portion)}
            kcal={portionNutrients(r.portion).kcal}
            onClick={() => setAmountOf(r.id)}
            trailing={<button className="del-btn" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))} aria-label={`${r.e.title} 빼기`}>✕</button>}
          />
        ))}
        <button className="fl-add" onClick={() => setPicking(true)}>+ 음식 추가</button>
      </FoodList>
      <p className="muted small">음식을 누르면 양을 바꿀 수 있어요.</p>
      {editing && (
        <Sheet title={editing.e.title} onClose={() => setAmountOf(null)} footer={<Btn kind="primary" className="foot-full" onClick={() => setAmountOf(null)}>완료</Btn>}>
          <AmountEditor portion={editing.portion} onChange={(p) => setPortion(editing.id, p)} />
          <p className="muted small">{Math.round(portionNutrients(editing.portion).kcal)}kcal · {macroLine(portionNutrients(editing.portion))}</p>
        </Sheet>
      )}
      {picking && <SavedFoodPicker onPick={(list) => { list.forEach(add); setPicking(false); }} onClose={() => setPicking(false)} />}
    </Screen>
  );
}

type PickTab = "fav" | "often" | "recent";
/** 세트에 넣을 음식 고르기: 탭(즐겨찾기·자주 먹는 것·최근) + 검색, 여러 개 체크해서 한 번에 */
function SavedFoodPicker({ onPick, onClose }: { onPick: (list: SavedFood[]) => void; onClose: () => void }) {
  const all = useLiveQuery(() => db.saved.toArray(), [], []);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<PickTab>("fav");
  const [sel, setSel] = useState<string[]>([]);
  const query = q.trim().toLowerCase();
  const byTab =
    query ? [...all].sort((a, b) => b.uses - a.uses || b.updatedAt - a.updatedAt)
    : tab === "fav" ? all.filter((s) => s.groupId != null).sort((a, b) => b.uses - a.uses)
    : tab === "often" ? all.filter((s) => s.uses > 0).sort((a, b) => b.uses - a.uses).slice(0, 30)
    : [...all].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  const list = byTab.filter((s) => !query || `${s.place ?? ""} ${s.title}`.toLowerCase().includes(query));
  const toggle = (key: string) => setSel((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  const tabs: [PickTab, string][] = [["fav", "즐겨찾기"], ["often", "자주 먹는 것"], ["recent", "최근"]];
  return (
    <FullScreen
      title="음식 추가"
      onClose={onClose}
      footer={<Btn kind="primary" className="foot-full" disabled={!sel.length} onClick={() => onPick(sel.map((k) => all.find((s) => s.key === k)!).filter(Boolean))}>{sel.length ? `${sel.length}개 넣기` : "음식을 골라 주세요"}</Btn>}
    >
      <TextInput className="search-input" value={q} onChange={setQ} placeholder="음식 검색" />
      {!query && (
        <div className="qa-tabs" role="tablist" aria-label="음식 모음">
          {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
        </div>
      )}
      <FoodList>
        {list.map((s) => (
          <FoodRow
            key={s.key}
            title={s.title}
            place={s.place}
            sub={servingText(s)}
            kcal={s.total.kcal}
            selected={sel.includes(s.key)}
            onClick={() => toggle(s.key)}
            trailing={<input type="checkbox" className="fr-check" checked={sel.includes(s.key)} onChange={() => toggle(s.key)} aria-label={`${s.title} 고르기`} />}
          />
        ))}
      </FoodList>
      {list.length === 0 && <p className="muted small">음식이 없어요</p>}
    </FullScreen>
  );
}

/** 저장한 음식의 양 ("150g", "1개") */
const servingText = (s: SavedFood) => {
  const g = s.items.every((i) => i.grams) ? Math.round(s.items.reduce((t, i) => t + (i.grams ?? 0), 0)) : 0;
  return g ? `${g}g` : s.items.length === 1 ? s.items[0].amountText || "" : `재료 ${s.items.length}개`;
};

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
