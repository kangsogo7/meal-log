import { useState } from "react";
import { db, scaleNutrients, sumNutrients, ZERO, type Item, type Nutrients } from "../db";
import { foodLabel, loadFoodDb, searchFoods, type Food } from "../foodDb";
import { GeminiError, resolveIngredients } from "../gemini";
import { useSettings } from "../hooks";
import { parseLines, type ParsedLine } from "../parse";
import { NumInput, NutrientEditor, NutrientLine } from "../components/ui";
import type { Draft } from "./AddSheet";
import { FavStar } from "../favorites";
import { norm, rankUserFoods, type UserFoodCand } from "../userFoods";

const AI = -1;
const MANUAL = -2;
/** 이전 기록·즐겨찾기 j번 = PREV - j */
const PREV = -10;

/** 예전에 먹은 것 (즐겨찾기 또는 이전 기록의 음식·재료) */
interface Prev { label: string; grams: number | null; nutrients: Nutrients; exact: boolean }

/** 재료와 비슷한 즐겨찾기·이전 기록 전부 (순서는 rankUserFoods: 즐겨찾기 → 이전 기록, 이름이 가까운 것 먼저) */
async function findPrev(names: string[]): Promise<Prev[][]> {
  const [saved, entries] = await Promise.all([db.saved.toArray(), db.entries.orderBy("createdAt").reverse().toArray()]);
  const pool: (Prev & UserFoodCand)[] = [];
  const seen = new Set<string>();
  for (const f of saved) {
    const name = `${f.place ? f.place + " " : ""}${f.title}`;
    const g = f.items.every((i) => i.grams) ? f.items.reduce((a, i) => a + (i.grams ?? 0), 0) : null;
    seen.add(norm(f.title));
    pool.push({ name: f.title, place: f.place, fav: f.groupId != null, at: f.updatedAt, label: `${f.groupId != null ? "★ " : "이전 기록 · "}${name}${g ? ` ${Math.round(g)}g` : ""}`, grams: g, nutrients: f.total, exact: false });
  }
  // 조리로 기록한 재료 하나하나도 (같은 이름은 가장 최근 것만)
  for (const e of entries) {
    if (e.items.length < 2) continue;
    for (const i of e.items) {
      const key = norm(i.name);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({ name: i.name, fav: false, at: e.createdAt, label: `이전 기록 · ${i.name}${i.grams ? ` ${Math.round(i.grams)}g` : ""}`, grams: i.grams, nutrients: i.nutrients, exact: false });
    }
  }
  return names.map((n) => rankUserFoods(pool, n).map(({ label, grams, nutrients, exact }) => ({ label, grams, nutrients, exact })));
}

interface Row {
  line: ParsedLine;
  candidates: Food[];
  prev: Prev[];
  choice: number; // 후보 인덱스 / AI / MANUAL / PREV - j
  grams: number | null;
  ai?: { grams: number; nutrients: Nutrients };
  manual: Nutrients;
}

const prevOf = (r: Row) => (r.choice <= PREV ? r.prev[PREV - r.choice] : undefined);

function rowNutrients(r: Row): Nutrients {
  const p = prevOf(r);
  if (p) return p.grams ? scaleNutrients(p.nutrients, (r.grams ?? p.grams) / p.grams) : p.nutrients;
  if (r.choice >= 0) return scaleNutrients(r.candidates[r.choice].per100, (r.grams ?? 0) / 100);
  if (r.choice === AI && r.ai) return r.ai.grams ? scaleNutrients(r.ai.nutrients, (r.grams ?? r.ai.grams) / r.ai.grams) : r.ai.nutrients;
  return r.manual;
}

export default function HomeForm({ onSave, actionLabel = "저장" }: { onSave: (d: Draft) => void; actionLabel?: string }) {
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
      // 이전 기록·즐겨찾기를 골라 둔 재료는 그대로 (AI 답은 목록에서 고를 수 있게만)
      if (r.choice <= PREV) return { ...r, ...(a.nutrients ? { ai: { grams: a.grams, nutrients: a.nutrients } } : {}) };
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
      const [list, prevs] = await Promise.all([loadFoodDb(), findPrev(lines.map((l) => l.name))]);
      let next: Row[] = lines.map((line, i) => {
        const candidates = searchFoods(list, line.name, { prefer: "ingredient", limit: 8 });
        const prev = prevs[i];
        // 이름이 똑같은 즐겨찾기·이전 기록이 있으면 그걸 먼저 고름 (g을 안 적었으면 그때 양)
        const p = prev[0]?.exact ? prev[0] : undefined;
        return { line, candidates, prev, choice: p ? PREV : candidates.length ? 0 : MANUAL, grams: line.grams ?? (p ? p.grams : null), manual: { ...ZERO } };
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
    source: r.choice <= PREV ? "saved" : r.choice >= 0 ? "db" : r.choice === AI ? "ai" : "manual",
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
                  <select value={r.choice} onChange={(e) => {
                    const choice = Number(e.target.value);
                    const p = choice <= PREV ? r.prev[PREV - choice] : undefined;
                    update(i, { choice, ...(p && !r.grams && p.grams ? { grams: p.grams } : {}) });
                  }}>
                    {r.prev.map((p, j) => <option key={`p${j}`} value={PREV - j}>{p.label}</option>)}
                    {r.candidates.map((c, j) => <option key={j} value={j}>{foodLabel(c)}</option>)}
                    {r.ai && <option value={AI}>AI 추정값</option>}
                    <option value={MANUAL}>직접 입력</option>
                  </select>
                  <label className="inline grams">
                    <NumInput value={r.grams} onChange={(g) => update(i, { grams: g })} placeholder="g" decimals={1} className={r.choice >= 0 && !r.grams ? "missing" : ""} />
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
          <button className="primary block" onClick={save} disabled={missingGrams}>{actionLabel}</button>
        </>
      )}
    </div>
  );
}
