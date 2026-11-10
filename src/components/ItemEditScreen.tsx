// 재료 수정 전체 화면 (기록 수정·음식 수정 공통): 이름 · 양 · 영양성분 · 재료 빼기. 완료를 눌러야 반영, ← 는 취소
import { useState } from "react";
import { r1, scaleNutrients, type Item, type Nutrients } from "../db";
import { FullScreen, NumInput, NutrientEditor, TextInput, Btn } from "./ui";

export default function ItemEditScreen({ item, title = "재료 수정", onDone, onRemove, onClose }: {
  item: Item;
  title?: string;
  onDone: (item: Item) => void;
  /** 없으면 "재료 빼기" 숨김 */
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(item);
  // 양을 바꾸면 이 기준에서 비율로 계산 (한 글자씩 입력해도 오차가 쌓이지 않게)
  const [base, setBase] = useState<{ grams: number | null; n: Nutrients }>({ grams: item.grams, n: item.nutrients });
  const setGrams = (g: number | null) => {
    if (!g || g <= 0) return setDraft({ ...draft, grams: null });
    setDraft({
      ...draft,
      grams: r1(g),
      amountText: `${r1(g)}g`,
      nutrients: base.grams ? scaleNutrients(base.n, g / base.grams) : draft.nutrients,
    });
  };
  const name = draft.name.trim();
  return (
    <FullScreen
      title={title}
      onClose={onClose}
      footer={
        <>
          {onRemove && <button className="danger-text" onClick={onRemove}>재료 빼기</button>}
          <Btn kind="primary" className="block big" disabled={!name} onClick={() => onDone({ ...draft, name })}>완료</Btn>
        </>
      }
    >
      <div className="form">
        <label>이름
          <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="재료 이름" />
        </label>
        <label>양 (g)
          <NumInput value={draft.grams} onChange={setGrams} decimals={1} placeholder="g" />
        </label>
        <NutrientEditor
          n={draft.nutrients}
          onChange={(n) => {
            setDraft({ ...draft, nutrients: n, source: "manual", via: undefined });
            setBase({ grams: draft.grams, n });
          }}
        />
      </div>
    </FullScreen>
  );
}
