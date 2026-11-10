import { useState } from "react";
import { db, sourceLabel, sumNutrients, type Entry, type Item } from "../db";
import { BackIcon, itemParts, MealTitle, Screen, SrcTag, TextInput } from "../components/ui";
import ItemEditScreen from "../components/ItemEditScreen";
import FoodView, { FoodActions } from "../components/FoodView";
import { portionItems, portionNutrients, storedPortion, type Portion } from "../portion";
import { FoodEditScreen } from "./FavEditors";
import { entryDraft, FavStar } from "../favorites";
import { shareOut } from "./QuickAdd";

/** 기록 수정 (전체 화면): 이름 · 끼니 · 영양 요약 · 먹은 양 · 재료 · 메모. 영양성분은 "영양성분 고치기"로 여는 음식 수정 화면에서 */
export default function EntrySheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [e, setE] = useState<Entry>(entry);
  // 양 조절: 저장할 때의 1회 제공량(×1)과 배수를 그대로 이어서
  const [portion, setPortion] = useState<Portion>(() => storedPortion(entry));
  // 재료를 고치면 고친 재료(지금 배수 기준)를 새 기준으로
  const [src, setSrc] = useState<{ items: Item[]; k?: number }>(entry);
  const [open, setOpen] = useState<number | null>(null);
  const [editFood, setEditFood] = useState(false);
  const items = portionItems(src, portion);
  const setItems = (next: Item[]) => {
    setSrc({ items: next, k: portion.k });
    setPortion(storedPortion({ items: next, total: sumNutrients(next.map((i) => i.nutrients)), k: portion.k }));
  };
  const total = sumNutrients([portionNutrients(portion)]);
  // 지금 화면 값 그대로의 기록
  const current: Entry = { ...e, items, total, k: portion.k };

  const save = async () => {
    try {
      await db.entries.put(current);
      onClose();
    } catch (err) {
      alert(`저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const remove = async () => {
    if (!confirm("이 기록을 삭제할까요?")) return;
    await db.entries.delete(e.id!);
    onClose();
  };

  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title={<MealTitle meal={e.meal} suffix=" 기록 수정" onChange={(meal) => setE({ ...e, meal })} />}
      right={<FavStar getDraft={() => entryDraft(current)} />}
      footer={
        <>
          <button className="danger-text" onClick={remove}>삭제</button>
          <button className="primary block big" onClick={save}>저장</button>
        </>
      }
    >
      <FoodView
        top={
          <>
            <TextInput className="entry-title" value={e.title} onChange={(v) => setE({ ...e, title: v })} aria-label="이름" />
            {e.place && <span className="muted small entry-place">{e.place}</span>}
          </>
        }
        n={total}
        portion={portion}
        onPortion={setPortion}
        parts={items.length > 1 ? {
          label: "재료",
          parts: itemParts(items, true),
          onPick: setOpen,
        } : undefined}
        actions={
          <>
            {items.length === 1 && <span className="muted small">출처<SrcTag label={sourceLabel(items[0])} /></span>}
            <FoodActions
              onEdit={() => setEditFood(true)}
              onShare={() => shareOut({ kind: current.kind, title: current.title, place: current.place, items: current.items, k: current.k })}
            />
          </>
        }
      >
        <label>메모
          <TextInput value={e.memo ?? ""} onChange={(v) => setE({ ...e, memo: v })} placeholder="예: 배불렀음" />
        </label>
      </FoodView>
      {/* 자주 먹는 것과 같은 음식 수정 화면. 완료하면 이 기록에만 반영되고, 아래 저장을 눌러야 저장됨 */}
      {editFood && (
        <FoodEditScreen
          food={{ kind: e.kind, title: e.title, place: e.place, items, total }}
          saveLabel="완료"
          amountLabel="먹은 양"
          onSave={({ title, place, items: next }) => { setE({ ...e, title, place }); setItems(next); setEditFood(false); }}
          onClose={() => setEditFood(false)}
        />
      )}
      {open != null && items[open] && (
        <ItemEditScreen
          item={items[open]}
          onDone={(it) => { setItems(items.map((x, j) => (j === open ? it : x))); setOpen(null); }}
          onRemove={items.length > 1 ? () => { setItems(items.filter((_, j) => j !== open)); setOpen(null); } : undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </Screen>
  );
}
