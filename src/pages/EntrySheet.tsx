import { useState } from "react";
import { db, MEALS, r1, scaleNutrients, sumNutrients, type Entry } from "../db";
import { NutrientEditor, NutrientLine, Sheet } from "../components/ui";

export default function EntrySheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [e, setE] = useState<Entry>(entry);

  const scale = (k: number) => {
    const items = e.items.map((i) => ({ ...i, grams: i.grams ? r1(i.grams * k) : i.grams, nutrients: scaleNutrients(i.nutrients, k) }));
    setE({ ...e, items, total: sumNutrients([scaleNutrients(e.total, k)]) });
  };

  const save = async () => {
    try {
      await db.entries.put(e);
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
        {e.kind === "out" && (
          <label>가게 이름
            <input value={e.place ?? ""} onChange={(ev) => setE({ ...e, place: ev.target.value })} />
          </label>
        )}
        <label>이름
          <input value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} />
        </label>

        <div className="scale-row">
          <span className="muted small">양 조절</span>
          {[0.5, 0.75, 1.25, 1.5, 2].map((k) => (
            <button key={k} className="chip" onClick={() => scale(k)}>×{k}</button>
          ))}
        </div>

        <NutrientEditor n={e.total} onChange={(total) => setE({ ...e, total })} />

        {e.items.length > 1 && (
          <>
            <p className="muted small">식재료</p>
            <ul className="mini-list">
              {e.items.map((i, idx) => (
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
