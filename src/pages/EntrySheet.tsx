import { useState } from "react";
import { db, KIND_LABEL, MEALS, r1, scaleNutrients, sumNutrients, type Entry, type EntryKind } from "../db";
import { NutrientEditor, NutrientLine, Sheet, Stepper } from "../components/ui";
import { entryDraft, FavStar } from "../favorites";

export default function EntrySheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [e, setE] = useState<Entry>(entry);
  // 양 조절은 처음 기록한 양(×1) 기준 배수
  const [k, setK] = useState(1);
  const [base, setBase] = useState({ items: entry.items, total: entry.total });

  const scale = (next: number) => {
    const items = base.items.map((i) => ({ ...i, grams: i.grams ? r1(i.grams * next) : i.grams, nutrients: scaleNutrients(i.nutrients, next) }));
    setK(next);
    setE({ ...e, items, total: sumNutrients([scaleNutrients(base.total, next)]) });
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
            <FavStar getDraft={() => entryDraft(e)} />
          </div>
        </label>

        <div className="scale-row">
          <span className="muted small">양 조절</span>
          <Stepper value={k} onChange={scale} />
        </div>

        <NutrientEditor
          n={e.total}
          onChange={(total) => {
            setE({ ...e, total });
            setBase({ ...base, total: scaleNutrients(total, 1 / k) }); // 고친 값을 현재 배수 기준으로
          }}
        />

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
