import { useState } from "react";
import { ZERO, type Nutrients } from "../db";
import { FoodFields } from "../components/FoodFields";
import type { Draft } from "./AddSheet";
import { FavStar } from "../favorites";

export default function ManualForm({ onSave, actionLabel = "저장" }: { onSave: (d: Draft) => void; actionLabel?: string }) {
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
      <FoodFields
        title={title}
        onTitle={setTitle}
        star={<FavStar getDraft={() => (title.trim() ? { kind: "manual", title: title.trim(), items: [{ name: title.trim(), amountText: amount, grams: null, source: "manual", nutrients: n }] } : null)} />}
        amountText={amount}
        onAmountText={setAmount}
        n={n}
        onN={setN}
      />
      {tried && !title.trim() && <p className="error">음식 이름을 입력해 주세요</p>}
      <button className="primary block" onClick={save}>{actionLabel}</button>
    </div>
  );
}
