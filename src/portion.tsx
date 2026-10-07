// 먹은 양 조절 — 앱 전체에서 이 파일 하나만 씀 (외식·식품 상세, 즐겨찾기, 기록 수정)
// 기준 양(×1)의 중량·영양성분 + 배수(k)로 지금 양을 계산
import { r1, scaleNutrients, type Item, type Nutrients } from "./db";
import { NumInput, Stepper } from "./components/ui";

export interface Portion {
  baseGrams: number | null; // ×1일 때 g (모르면 null → 배수로만 조절)
  base: Nutrients; // ×1일 때 영양성분
  k: number; // 배수
}

export function makePortion(base: Nutrients, baseGrams?: number | null, k = 1): Portion {
  return { base, baseGrams: baseGrams && baseGrams > 0 ? baseGrams : null, k };
}

export const portionGrams = (p: Portion) => (p.baseGrams ? r1(p.baseGrams * p.k) : null);
export const portionNutrients = (p: Portion) => scaleNutrients(p.base, p.k);

/** 영양성분을 직접 고친 경우: 지금 배수 기준으로 ×1 값을 다시 잡아서 이후 양 조절에도 반영 */
export const withNutrients = (p: Portion, n: Nutrients): Portion => ({ ...p, base: p.k ? scaleNutrients(n, 1 / p.k) : n });

/** 재료 여러 개짜리(조리)의 ×1 총 중량: 모든 재료에 g이 있을 때만 */
export function itemsGrams(items: Item[]): number | null {
  if (!items.length || items.some((i) => !i.grams)) return null;
  return items.reduce((s, i) => s + (i.grams ?? 0), 0);
}

/** 재료 목록을 배수만큼 늘리거나 줄임 */
export const scaleItems = (items: Item[], k: number): Item[] =>
  items.map((i) => ({ ...i, grams: i.grams ? r1(i.grams * k) : i.grams, nutrients: scaleNutrients(i.nutrients, k) }));

/** 저장된 기록·즐겨찾기(먹은 양 + 배수 k) → 양 조절. 기준(×1) = 먹은 양 ÷ k */
export function storedPortion(s: { total: Nutrients; items: Item[]; k?: number }): Portion {
  const k = s.k && s.k > 0 ? s.k : 1;
  const g = itemsGrams(s.items);
  return makePortion(scaleNutrients(s.total, 1 / k), g ? g / k : null, k);
}

/** 저장된 재료를 고른 양으로 (재료가 하나면 영양성분을 직접 고친 값도 반영) */
export function portionItems(s: { items: Item[]; k?: number }, p: Portion): Item[] {
  const items = scaleItems(s.items, p.k / (s.k && s.k > 0 ? s.k : 1));
  if (items.length !== 1) return items;
  const g = portionGrams(p);
  return [{ ...items[0], grams: g ?? items[0].grams, amountText: g ? `${g}g` : items[0].amountText, nutrients: portionNutrients(p) }];
}

/** 먹은 양 g 입력(소수점 한 자리) + − ×배수 + */
export function AmountEditor({ portion, onChange }: { portion: Portion; onChange: (p: Portion) => void }) {
  return (
    <div className="amount-row">
      {portion.baseGrams && (
        <label className="inline">
          먹은 양
          <NumInput
            value={portionGrams(portion)}
            onChange={(g) => g != null && onChange({ ...portion, k: g / portion.baseGrams! })}
            placeholder="g"
            decimals={1}
          />
          <span className="muted">g</span>
        </label>
      )}
      <Stepper value={portion.k} onChange={(k) => onChange({ ...portion, k })} />
    </div>
  );
}
