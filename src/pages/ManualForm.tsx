// 숫자 입력: 영양성분 고치기 화면과 같은 입력칸(FoodFields), 아래 버튼도 같은 자리
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { r1, ZERO, type Nutrients } from "../db";
import { FoodFields } from "../components/FoodFields";
import { Btn } from "../components/ui";
import type { Draft } from "./AddSheet";

export default function ManualForm({ onSave, actionLabel = "저장" }: { onSave: (d: Draft) => void; actionLabel?: string }) {
  const [title, setTitle] = useState("");
  const [grams, setGrams] = useState<number | null>(null);
  const [n, setN] = useState<Nutrients>({ ...ZERO });
  const [tried, setTried] = useState(false);
  // 버튼은 화면 아래 칸(식단 기록 화면의 #add-foot)에
  const [footEl, setFootEl] = useState<Element | null>(null);
  useEffect(() => setFootEl(document.getElementById("add-foot")), []);

  const save = () => {
    setTried(true);
    const t = title.trim();
    if (!t) return;
    const g = grams ? r1(grams) : null;
    onSave({ kind: "manual", title: t, items: [{ name: t, amountText: g ? `${g}g` : "", grams: g, source: "manual", nutrients: n }] });
  };

  const foot = <Btn kind="primary" className="foot-full" onClick={save}>{actionLabel}</Btn>;
  return (
    <div className="form">
      <FoodFields title={title} onTitle={setTitle} grams={grams} onGrams={setGrams} n={n} onN={setN} />
      {tried && !title.trim() && <p className="error">음식 이름을 입력해 주세요</p>}
      {footEl ? createPortal(foot, footEl) : foot}
    </div>
  );
}
