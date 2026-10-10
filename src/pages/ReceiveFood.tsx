// 공유받은 음식(링크·그룹의 "나도 기록")을 양만 확인하고 바로 오늘 식단에 기록
import { useState } from "react";
import { MEALS, sumNutrients, todayStr, type Meal } from "../db";
import { flash, NutrientGrid, Sheet } from "../components/ui";
import { AmountEditor, portionItems, portionNutrients, storedPortion } from "../portion";
import type { SharedFood } from "../foodShare";
import { saveEntry } from "./AddSheet";

/** 지금 시간에 맞는 끼니 */
function mealNow(): Meal {
  const h = new Date().getHours();
  return h < 10 ? "breakfast" : h < 15 ? "lunch" : h < 17 ? "snack" : "dinner";
}

export default function ReceiveFood({ food, from, onClose, onSaved }: { food: SharedFood; from?: string; onClose: () => void; onSaved?: () => void }) {
  const [meal, setMeal] = useState<Meal>(mealNow);
  const [portion, setPortion] = useState(() => storedPortion({ items: food.items, k: food.k, total: sumNutrients(food.items.map((i) => i.nutrients)) }));
  const [busy, setBusy] = useState(false);
  const label = MEALS.find((m) => m.key === meal)!.label;

  const save = async () => {
    setBusy(true);
    try {
      await saveEntry(todayStr(), meal, {
        kind: food.kind, title: food.title, place: food.place,
        items: portionItems({ items: food.items, k: food.k }, portion), k: portion.k,
      });
      flash(`오늘 ${label}에 기록했어요`);
      onSaved?.();
      onClose();
    } catch (e) {
      alert(`저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="나도 기록하기"
      onClose={onClose}
      footer={<button className="primary block big" onClick={save} disabled={busy}>{busy ? "기록하는 중..." : `오늘 ${label}으로 기록`}</button>}
    >
      <div className="form food-detail">
        <div className="receive-head">
          {from && <span className="muted small">{from}님이 공유한 음식</span>}
          <b>{food.place && <span className="muted">{food.place} </span>}{food.title}</b>
          {food.items.length > 1 && <span className="muted small">재료: {food.items.map((i) => i.name).join(" · ")}</span>}
        </div>
        <NutrientGrid n={portionNutrients(portion)} />
        <AmountEditor portion={portion} onChange={setPortion} />
        <div className="seg meal-seg">
          {MEALS.map((m) => (
            <button key={m.key} className={meal === m.key ? "on" : ""} onClick={() => setMeal(m.key)}>{m.label}</button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
