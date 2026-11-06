import { useState } from "react";
import { db, r1, scaleNutrients, sourceLabel, sumNutrients, type Entry, type Item } from "../db";
import { BackIcon, MealSeg, NumInput, NutrientEditor, Screen, SrcTag } from "../components/ui";
import FoodView, { FoodActions } from "../components/FoodView";
import { portionItems, portionNutrients, storedPortion, withNutrients, type Portion } from "../portion";
import { entryDraft, FavStar } from "../favorites";
import { shareOut } from "./QuickAdd";

/** 기록 수정 (전체 화면): 이름 · 끼니 · 영양 요약 · 먹은 양 · 재료 · 메모. 영양성분 숫자는 "직접 고치기"를 눌러야 보임 */
export default function EntrySheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [e, setE] = useState<Entry>(entry);
  // 양 조절: 저장할 때의 1회 제공량(×1)과 배수를 그대로 이어서
  const [portion, setPortion] = useState<Portion>(() => storedPortion(entry));
  // 재료를 고치면 고친 재료(지금 배수 기준)를 새 기준으로
  const [src, setSrc] = useState<{ items: Item[]; k?: number }>(entry);
  const [open, setOpen] = useState<number | null>(null);
  // 영양성분을 직접 고치면 출처는 "직접 입력"
  const [ownN, setOwnN] = useState(false);
  const [editN, setEditN] = useState(false);
  const scaled = portionItems(src, portion);
  const items = ownN && scaled.length === 1 ? [{ ...scaled[0], source: "manual" as const, via: undefined }] : scaled;
  const setItems = (next: Item[]) => {
    setSrc({ items: next, k: portion.k });
    setPortion(storedPortion({ items: next, total: sumNutrients(next.map((i) => i.nutrients)), k: portion.k }));
  };
  const editItem = (i: number, patch: Partial<Item>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const it = open != null ? items[open] : undefined;
  const itemEditor = it && open != null && (
    <>
      <label>재료 이름
        <input value={it.name} onChange={(ev) => editItem(open, { name: ev.target.value })} />
      </label>
      <label className="inline">
        양
        <NumInput
          value={it.grams}
          onChange={(g) => {
            if (g == null || g <= 0) return;
            // g을 바꾸면 영양성분도 같은 비율로
            editItem(open, { grams: r1(g), amountText: `${r1(g)}g`, nutrients: it.grams ? scaleNutrients(it.nutrients, g / it.grams) : it.nutrients });
          }}
          placeholder="g"
          decimals={1}
        />
        <span className="muted">g</span>
      </label>
      <NutrientEditor n={it.nutrients} onChange={(n) => editItem(open, { nutrients: n, source: "manual", via: undefined })} />
      <div className="btn-row">
        {items.length > 1 && <button className="danger" onClick={() => { setItems(items.filter((_, j) => j !== open)); setOpen(null); }}>재료 빼기</button>}
        <button onClick={() => setOpen(null)}>닫기</button>
      </div>
    </>
  );
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
      title="기록 수정"
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
            <input className="entry-title" value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} aria-label="이름" />
            {e.place && <span className="muted small entry-place">{e.place}</span>}
            <MealSeg value={e.meal} onChange={(meal) => setE({ ...e, meal })} />
          </>
        }
        n={total}
        portion={portion}
        onPortion={setPortion}
        parts={items.length > 1 ? {
          label: "재료",
          parts: items.map((i) => ({ name: i.name, amount: i.grams ? `${Math.round(i.grams)}g` : i.amountText, n: i.nutrients, tag: sourceLabel(i) })),
          onPick: (i: number) => setOpen(open === i ? null : i),
          open,
          editor: itemEditor,
        } : undefined}
        actions={
          <>
            {items.length === 1 && <span className="muted small">출처<SrcTag label={sourceLabel(items[0])} /></span>}
            <FoodActions
              editOn={editN}
              onEdit={() => setEditN(!editN)}
              onShare={() => shareOut({ kind: current.kind, title: current.title, place: current.place, items: current.items, k: current.k })}
            />
          </>
        }
      >
        {editN && <NutrientEditor n={total} onChange={(n) => { setOwnN(true); setPortion(withNutrients(portion, n)); }} />}
        <label>메모
          <input value={e.memo ?? ""} onChange={(ev) => setE({ ...e, memo: ev.target.value })} placeholder="예: 배불렀음" />
        </label>
      </FoodView>
    </Screen>
  );
}
