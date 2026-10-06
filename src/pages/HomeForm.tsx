import { useState } from "react";
import { scaleNutrients, sumNutrients, ZERO, type Item, type Nutrients } from "../db";
import { foodLabel, loadFoodDb, searchFoods, type Food } from "../foodDb";
import { GeminiError, resolveIngredients } from "../gemini";
import { useSettings } from "../hooks";
import { parseLines, type ParsedLine } from "../parse";
import { NumInput, NutrientEditor, NutrientLine } from "../components/ui";
import type { Draft } from "./AddSheet";
import { FavStar } from "../favorites";

const AI = -1;
const MANUAL = -2;

interface Row {
  line: ParsedLine;
  candidates: Food[];
  choice: number; // 후보 인덱스 / AI / MANUAL
  grams: number | null;
  ai?: { grams: number; nutrients: Nutrients };
  manual: Nutrients;
}

function rowNutrients(r: Row): Nutrients {
  if (r.choice >= 0) return scaleNutrients(r.candidates[r.choice].per100, (r.grams ?? 0) / 100);
  if (r.choice === AI && r.ai) return r.ai.grams ? scaleNutrients(r.ai.nutrients, (r.grams ?? r.ai.grams) / r.ai.grams) : r.ai.nutrients;
  return r.manual;
}

export default function HomeForm({ onSave }: { onSave: (d: Draft) => void }) {
  const settings = useSettings();
  const [dish, setDish] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiUsed, setAiUsed] = useState(false);

  const askAi = async (base: Row[]) => {
    const answers = await resolveIngredients(settings, base.map((r) => ({ text: r.line.text, candidates: r.candidates.map(foodLabel) })));
    setAiUsed(true);
    return base.map((r, i) => {
      const a = answers[i];
      const grams = r.line.grams ?? (a.grams || null);
      if (a.match >= 0) return { ...r, choice: a.match, grams };
      if (a.nutrients) return { ...r, choice: AI, grams, ai: { grams: a.grams, nutrients: a.nutrients } };
      return { ...r, grams };
    });
  };

  const analyze = async () => {
    const lines = parseLines(text);
    if (!lines.length) return;
    setBusy(true);
    setError("");
    try {
      const list = await loadFoodDb();
      let next: Row[] = lines.map((line) => {
        const candidates = searchFoods(list, line.name, { prefer: "ingredient", limit: 8 });
        return { line, candidates, choice: candidates.length ? 0 : MANUAL, grams: line.grams, manual: { ...ZERO } };
      });
      if (settings.geminiKey) {
        try {
          next = await askAi(next);
        } catch (e) {
          setError(e instanceof GeminiError ? `${e.message} (식약처 DB 결과만 보여 드려요)` : "AI 확인에 실패해서 식약처 DB 결과만 보여 드려요.");
        }
      }
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const retryAi = async () => {
    if (!rows) return;
    setBusy(true);
    setError("");
    try {
      setRows(await askAi(rows));
    } catch (e) {
      setError(e instanceof GeminiError ? e.message : "AI 확인에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const items: Item[] = (rows ?? []).map((r) => ({
    name: r.line.name,
    amountText: r.line.amountText || (r.grams ? `${r.grams}g` : ""),
    grams: r.grams,
    source: r.choice >= 0 ? "db" : r.choice === AI ? "ai" : "manual",
    matchName: r.choice >= 0 ? r.candidates[r.choice].name : undefined,
    nutrients: rowNutrients(r),
  }));
  const total = sumNutrients(items.map((i) => i.nutrients));
  const missing = (rows ?? []).filter((r) => r.choice >= 0 && !r.grams).map((r) => r.line.name);
  const missingGrams = missing.length > 0;

  const save = () => {
    const title = dish.trim() || items.map((i) => i.name).join(", ");
    onSave({ kind: "home", title, items });
  };

  return (
    <div className="form">
      <label>요리 이름
        <input value={dish} onChange={(e) => setDish(e.target.value)} placeholder="선택 · 예: 닭가슴살 볶음밥" />
      </label>
      <label>식재료
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"현미밥 200g\n계란 2개\n닭가슴살 100g\n올리브유 1큰술"} />
      </label>
      <button className="primary block" onClick={analyze} disabled={!text.trim() || busy}>
        {busy ? "찾는 중..." : "영양성분 찾기"}
      </button>
      {error && <p className="error">{error}</p>}

      {rows && (
        <>
          <ul className="ing-list">
            {rows.map((r, i) => (
              <li key={i} className="card inset">
                <div className="ing-head">
                  <b>{r.line.text}</b>
                  <NutrientLine n={items[i].nutrients} />
                </div>
                <div className="ing-controls">
                  <select value={r.choice} onChange={(e) => update(i, { choice: Number(e.target.value) })}>
                    {r.candidates.map((c, j) => <option key={j} value={j}>{foodLabel(c)}</option>)}
                    {r.ai && <option value={AI}>AI 추정값</option>}
                    <option value={MANUAL}>직접 입력</option>
                  </select>
                  <label className="inline grams">
                    <NumInput value={r.grams} onChange={(g) => update(i, { grams: g })} placeholder="g" className={r.choice >= 0 && !r.grams ? "missing" : ""} />
                    <em>g</em>
                  </label>
                </div>
                {r.choice === MANUAL && <NutrientEditor n={r.manual} onChange={(n) => update(i, { manual: n })} />}
              </li>
            ))}
          </ul>
          {settings.geminiKey && !aiUsed && (
            <button className="block" onClick={retryAi} disabled={busy}>AI로 다시 확인</button>
          )}
          <div className="card inset total">
            <span>합계</span>
            <NutrientLine n={total} />
            <FavStar getDraft={() => (missingGrams ? null : { kind: "home", title: dish.trim() || items.map((i) => i.name).join(", "), items })} />
          </div>
          {missingGrams && <p className="error">g 입력 필요: {missing.join(", ")}</p>}
          <button className="primary block" onClick={save} disabled={missingGrams}>저장</button>
        </>
      )}
    </div>
  );
}
