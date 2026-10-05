import { useState } from "react";
import { ZERO, type Nutrients } from "../db";
import { NutrientEditor } from "../components/ui";
import type { Draft } from "./AddSheet";

export default function ManualForm({ onSave }: { onSave: (d: Draft) => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [n, setN] = useState<Nutrients>({ ...ZERO });

  return (
    <div className="form">
      <label>음식 이름
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 프로틴 쉐이크" />
      </label>
      <label>양 <span className="muted">(선택)</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 1스쿱" />
      </label>
      <NutrientEditor n={n} onChange={setN} />
      <p className="muted small">제품 포장지의 영양정보를 보고 입력하세요.</p>
      <button
        className="primary block"
        disabled={!title.trim()}
        onClick={() => onSave({ kind: "manual", title: title.trim(), items: [{ name: title.trim(), amountText: amount, grams: null, source: "manual", nutrients: n }] })}
      >
        저장
      </button>
    </div>
  );
}
