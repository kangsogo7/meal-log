import { useState } from "react";
import { db, KIND_LABEL, MEALS, sumNutrients, type Entry, type EntryKind } from "../db";
import { NutrientEditor, NutrientLine, Sheet } from "../components/ui";
import { AmountEditor, portionItems, portionNutrients, storedPortion, withNutrients, type Portion } from "../portion";
import { entryDraft, FavStar } from "../favorites";

export default function EntrySheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [e, setE] = useState<Entry>(entry);
  // 양 조절: 저장할 때의 1회 제공량(×1)과 배수를 그대로 이어서
  const [portion, setPortion] = useState<Portion>(() => storedPortion(entry));
  const items = portionItems(entry, portion);
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
    <Sheet
      title="기록 수정"
      onClose={onClose}
      footer={
        <>
          <button className="danger" onClick={remove}>삭제</button>
          <span className="spacer" />
          <button onClick={onClose}>취소</button>
          <button className="primary" onClick={save}>저장</button>
        </>
      }
    >
      <div className="form">
        <div className="seg meal-seg">
          {MEALS.map((m) => (
            <button key={m.key} className={e.meal === m.key ? "on" : ""} onClick={() => setE({ ...e, meal: m.key })}>{m.label}</button>
          ))}
        </div>
        <div className="seg">
          {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => (
            <button key={k} className={e.kind === k ? "on" : ""} onClick={() => setE({ ...e, kind: k })}>
              {k === "manual" ? "직접 입력" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {(e.kind === "out" || e.kind === "food") && (
          <label>{e.kind === "out" ? "가게 이름" : "제조사"}
            <input value={e.place ?? ""} onChange={(ev) => setE({ ...e, place: ev.target.value })} placeholder="선택" />
          </label>
        )}
        <label>이름
          <div className="input-with-star">
            <input value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} />
            <FavStar getDraft={() => entryDraft(current)} />
          </div>
        </label>

        <AmountEditor portion={portion} onChange={setPortion} />
        <NutrientEditor n={total} onChange={(n) => setPortion(withNutrients(portion, n))} />

        {items.length > 1 && (
          <>
            <p className="muted small">식재료</p>
            <ul className="mini-list">
              {items.map((i, idx) => (
                <li key={idx}>
                  <span>{i.name} {i.grams ? `${Math.round(i.grams)}g` : i.amountText}</span>
                  <NutrientLine n={i.nutrients} />
                </li>
              ))}
            </ul>
          </>
        )}

        <label>메모
          <input value={e.memo ?? ""} onChange={(ev) => setE({ ...e, memo: ev.target.value })} placeholder="예: 배불렀음" />
        </label>
      </div>
    </Sheet>
  );
}
