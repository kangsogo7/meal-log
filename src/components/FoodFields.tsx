// 음식 이름 · 먹은 양 · 영양성분 입력칸 묶음 (숫자 입력, 영양성분 고치기 공통). 제조사 칸은 두지 않음
import type { ReactNode } from "react";
import type { Nutrients } from "../db";
import { NumInput, NutrientEditor, TextInput } from "./ui";

export function FoodFields({ title, onTitle, star, place, onPlace, grams, onGrams, amountText, onAmountText, amountLabel = "먹은 양", n, onN }: {
  title: string; onTitle: (v: string) => void;
  /** 이름 칸 오른쪽 즐겨찾기 별 */
  star?: ReactNode;
  /** 외식만: 가게 이름 */
  place?: string; onPlace?: (v: string) => void;
  /** g을 아는 음식은 g 숫자칸, 아니면 글자칸("1스쿱") */
  grams?: number | null; onGrams?: (v: number | null) => void;
  amountText?: string; onAmountText?: (v: string) => void;
  amountLabel?: string;
  n: Nutrients; onN: (n: Nutrients) => void;
}) {
  return (
    <>
      <label>음식 이름
        <div className="input-with-star">
          <TextInput value={title} onChange={onTitle} placeholder="예: 프로틴 쉐이크" />
          {star}
        </div>
      </label>
      {onPlace && (
        <label>가게 이름
          <TextInput value={place ?? ""} onChange={onPlace} placeholder="선택" />
        </label>
      )}
      {onGrams ? (
        <label>{amountLabel} (g)
          <NumInput value={grams} onChange={onGrams} decimals={1} placeholder="g" />
        </label>
      ) : (
        <label>{amountLabel}
          <TextInput value={amountText ?? ""} onChange={(v) => onAmountText?.(v)} placeholder="선택 · 예: 1스쿱" />
        </label>
      )}
      <p className="label">{amountLabel} 영양성분</p>
      <NutrientEditor n={n} onChange={onN} />
    </>
  );
}
