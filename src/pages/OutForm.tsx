import { useState } from "react";
import { db, savedKey, scaleNutrients, type ItemSource, type Nutrients } from "../db";
import { foodLabel, hasBrand, loadFoodDb, searchFoods, type Food } from "../foodDb";
import { estimateMenu, GeminiError } from "../gemini";
import { useSettings } from "../hooks";
import { NumInput, NutrientEditor, NutrientLine } from "../components/ui";
import type { Draft } from "./AddSheet";

interface Choice {
  label: string;
  source: ItemSource;
  matchName?: string;
  per100?: Nutrients; // DB 값이면 g으로 다시 계산
  grams: number | null;
  nutrients: Nutrients;
  note?: string;
}

export default function OutForm({ onSave }: { onSave: (d: Draft) => void }) {
  const settings = useSettings();
  const [place, setPlace] = useState("");
  const [menu, setMenu] = useState("");
  const [amount, setAmount] = useState("1인분");
  const [results, setResults] = useState<Food[] | null>(null);
  const [savedHit, setSavedHit] = useState<Choice | null>(null);
  const [aiChoice, setAiChoice] = useState<Choice | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState<"" | "db" | "ai">("");
  const [error, setError] = useState("");

  const runAi = async (refs: Food[]) => {
    setBusy("ai");
    setError("");
    try {
      const est = await estimateMenu(settings, place, menu, amount,
        refs.slice(0, 5).map((f) => `${foodLabel(f)}: ${f.per100.kcal}kcal, 탄${f.per100.carb} 단${f.per100.protein} 지${f.per100.fat}${f.serving ? `, 1회 ${f.serving}g` : ""}`));
      const c: Choice = { label: `AI 추정: ${est.name}`, source: "ai", grams: est.grams || null, nutrients: est.nutrients, note: est.note };
      setAiChoice(c);
      setChoice(c);
    } catch (e) {
      setError(e instanceof GeminiError ? e.message : "AI 추정에 실패했어요.");
    } finally {
      setBusy("");
    }
  };

  const search = async () => {
    if (!menu.trim()) return;
    setBusy("db");
    setError("");
    setChoice(null);
    setAiChoice(null);
    try {
      const prev = await db.saved.get(savedKey("out", place, menu));
      setSavedHit(prev ? { label: "이전에 기록한 값", source: "saved", grams: prev.items[0]?.grams ?? null, nutrients: prev.total } : null);

      const list = await loadFoodDb();
      const brand = place.trim() && hasBrand(list, place) ? place : undefined;
      let found = searchFoods(list, menu, { prefer: "dish", brand, limit: 6 });
      if (brand && found.length === 0) found = searchFoods(list, menu, { prefer: "dish", limit: 6 });
      setResults(found);
      setBusy("");
      // DB에 해당 가게 메뉴가 없으면 바로 AI에게 물어보기
      if (!prev && !brand && settings.geminiKey && place.trim()) await runAi(found);
      else if (!prev && found.length === 0 && settings.geminiKey) await runAi(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  };

  const pickFood = (f: Food) => {
    const grams = f.serving || 100;
    setChoice({ label: foodLabel(f), source: "db", matchName: f.name, per100: f.per100, grams, nutrients: scaleNutrients(f.per100, grams / 100), note: f.partial ? "식약처 DB에 탄수화물·지방 값이 없는 메뉴예요. 알고 있으면 직접 고쳐 주세요." : undefined });
  };

  const setGrams = (g: number | null) => {
    if (!choice) return;
    if (choice.per100) setChoice({ ...choice, grams: g, nutrients: scaleNutrients(choice.per100, (g ?? 0) / 100) });
    else if (choice.grams && g) setChoice({ ...choice, grams: g, nutrients: scaleNutrients(choice.nutrients, g / choice.grams) });
    else setChoice({ ...choice, grams: g });
  };

  const save = () => {
    if (!choice) return;
    onSave({
      kind: "out",
      title: menu.trim(),
      place: place.trim() || undefined,
      items: [{ name: menu.trim(), amountText: amount, grams: choice.grams, source: choice.source, matchName: choice.matchName, nutrients: choice.nutrients }],
    });
  };

  return (
    <div className="form">
      <label>가게 이름 <span className="muted">(선택)</span>
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="예: 교촌치킨, 동네 김밥집" />
      </label>
      <label>메뉴
        <input value={menu} onChange={(e) => setMenu(e.target.value)} placeholder="예: 허니콤보, 김치찌개" onKeyDown={(e) => e.key === "Enter" && search()} />
      </label>
      <label>먹은 양
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 1인분, 반마리, 2조각" />
      </label>
      <button className="primary block" onClick={search} disabled={!menu.trim() || !!busy}>
        {busy === "db" ? "찾는 중..." : "영양성분 찾기"}
      </button>
      {error && <p className="error">{error}</p>}

      {results && (
        <div className="results">
          {savedHit && <ChoiceButton c={savedHit} selected={choice === savedHit} onClick={() => setChoice(savedHit)} />}
          {aiChoice && <ChoiceButton c={aiChoice} selected={choice === aiChoice} onClick={() => setChoice(aiChoice)} />}
          {results.length > 0 && <p className="muted small">식약처 DB 검색 결과</p>}
          {results.map((f, i) => (
            <button key={i} className={`result ${choice?.matchName === f.name && choice.source === "db" ? "selected" : ""}`} onClick={() => pickFood(f)}>
              <div>{foodLabel(f)}</div>
              <NutrientLine n={scaleNutrients(f.per100, (f.serving || 100) / 100)} />
              <span className="muted small"> ({f.serving || 100}g 기준)</span>
            </button>
          ))}
          {results.length === 0 && !aiChoice && !busy && <p className="muted small">식약처 DB에서 찾지 못했어요.</p>}
          {!aiChoice && (
            settings.geminiKey ? (
              <button className="block" onClick={() => runAi(results)} disabled={!!busy}>
                {busy === "ai" ? "AI가 찾는 중..." : "✨ AI에게 물어보기"}
              </button>
            ) : (
              <p className="muted small">설정에서 Gemini API 키를 넣으면 DB에 없는 메뉴도 AI가 찾아 줘요.</p>
            )
          )}
        </div>
      )}

      {choice && (
        <div className="card inset">
          <p className="small"><b>{choice.label}</b></p>
          {choice.note && <p className="muted small">{choice.note}</p>}
          <label className="inline">먹은 양(g)
            <NumInput value={choice.grams} onChange={setGrams} placeholder="g" />
          </label>
          <NutrientEditor n={choice.nutrients} onChange={(n) => setChoice({ ...choice, nutrients: n, per100: undefined })} />
          <button className="primary block" onClick={save}>저장</button>
        </div>
      )}
    </div>
  );
}

function ChoiceButton({ c, selected, onClick }: { c: Choice; selected: boolean; onClick: () => void }) {
  return (
    <button className={`result ${c.source} ${selected ? "selected" : ""}`} onClick={onClick}>
      <div>{c.label}</div>
      <NutrientLine n={c.nutrients} />
      {c.note && <div className="muted small">{c.note}</div>}
    </button>
  );
}
