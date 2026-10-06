import { useState } from "react";
import { ZERO, type Nutrients } from "../db";
import { NutrientEditor } from "../components/ui";
import type { Draft } from "./AddSheet";
import { FavStar } from "../favorites";

export default function ManualForm({ onSave }: { onSave: (d: Draft) => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [n, setN] = useState<Nutrients>({ ...ZERO });
  const [tried, setTried] = useState(false);

  const save = () => {
    setTried(true);
    if (!title.trim()) return;
    onSave({ kind: "manual", title: title.trim(), items: [{ name: title.trim(), amountText: amount, grams: null, source: "manual", nutrients: n }] });
  };

  return (
    <div className="form">
      <label>음식 이름
        <div className="input-with-star">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 프로틴 쉐이크" />
          <FavStar getDraft={() => (title.trim() ? { kind: "manual", title: title.trim(), items: [{ name: title.trim(), amountText: amount, grams: null, source: "manual", nutrients: n }] } : null)} />
        </div>
      </label>
      <label>양
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="선택 · 예: 1스쿱" />
      </label>
      <NutrientEditor n={n} onChange={setN} />
      {tried && !title.trim() && <p className="error">음식 이름을 입력해 주세요</p>}
      <button className="primary block" onClick={save}>저장</button>
    </div>
  );
}
