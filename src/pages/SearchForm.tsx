// 외식 / 식품 공통: 입력칸 하나 → 목록 → 누르면 영양성분 상세 + 저장
import { useEffect, useRef, useState } from "react";
import { db, savedKey, scaleNutrients, type ItemSource, type Nutrients } from "../db";
import { foodLabel, listGrams, loadFoodDb, loadProductDb, searchFoods, splitBrand, type Food } from "../foodDb";
import { estimateMenu, GeminiError } from "../gemini";
import { useSettings } from "../hooks";
import { NumInput, NutrientEditor, NutrientLine, Stepper } from "../components/ui";
import type { Draft } from "./AddSheet";
import { FavStar, type FavDraft } from "../favorites";

interface Choice {
  id: string;
  label: string;
  title: string; // 저장할 이름
  place?: string; // 저장할 상호/제조사
  source: ItemSource;
  matchName?: string;
  per100?: Nutrients; // DB 값이면 g으로 다시 계산
  baseGrams: number | null; // ×1 기준 양
  grams: number | null;
  nutrients: Nutrients;
  note?: string;
  k?: number; // 중량을 모를 때의 배수
  base?: Nutrients; // 중량을 모를 때 ×1 영양성분
}

const COPY = {
  out: { placeholder: "상호 메뉴명 (예: 교촌치킨 허니콤보)", amount: "1인분", empty: "검색 결과가 없어요" },
  food: { placeholder: "식품 이름 (예: 그릭요거트, 바나나)", amount: "1개 (1회 제공량)", empty: "검색 결과가 없어요" },
};

export default function SearchForm({ kind, onSave }: { kind: "out" | "food"; onSave: (d: Draft) => void }) {
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [split, setSplit] = useState<{ brand?: string; rest: string }>({ rest: "" });
  const [savedHit, setSavedHit] = useState<Choice | null>(null);
  const [aiChoice, setAiChoice] = useState<Choice | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState<"" | "db" | "ai">("");
  const [error, setError] = useState("");
  const detailRef = useRef<HTMLDivElement>(null);
  const copy = COPY[kind];

  // 입력할 때마다 식약처 DB 검색 (기기 안에서 하므로 빠름)
  useEffect(() => {
    const q = query.trim();
    setAiChoice(null);
    if (q.length < 1) {
      setResults([]);
      setSavedHit(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setBusy((b) => b || "db");
        const base = await loadFoodDb();
        let found: Food[];
        let sp: { brand?: string; rest: string };
        if (kind === "out") {
          sp = splitBrand(base, q);
          found = sp.brand && sp.rest ? searchFoods(base, sp.rest, { prefer: "dish", brand: sp.brand, limit: 8 }) : [];
          if (found.length < 3) {
            const more = searchFoods(base, sp.rest || q, { prefer: "dish", limit: 8 }).filter((f) => !found.includes(f));
            found = [...found, ...more].slice(0, 8);
          }
        } else {
          const prods = await loadProductDb();
          sp = splitBrand(prods, q);
          let fromProducts = searchFoods(prods, sp.rest || q, { brand: sp.brand, limit: 8 });
          if (sp.brand && fromProducts.length === 0) fromProducts = searchFoods(prods, q, { limit: 8 });
          // 과일·우유 같은 일반 식품: 이름이 검색어로 시작할 때만 맨 위에
          const head = q.split(/\s+/)[0];
          const fromBase = sp.brand ? [] : searchFoods(base.filter((f) => f.kind === 0), q, { prefer: "ingredient", limit: 4 });
          const strong = q.includes(" ") ? [] : fromBase.filter((f) => f.name.startsWith(head));
          found = [...new Set([...strong.slice(0, 2), ...fromProducts, ...fromBase])].slice(0, 10);
        }
        // 그 외식/식품을 이전에 기록했으면 맨 위에
        const placeGuess = sp.brand ?? (kind === "out" && q.includes(" ") ? q.split(/\s+/)[0] : undefined);
        const titleGuess = sp.brand ? sp.rest : placeGuess ? q.slice(placeGuess.length).trim() : q;
        const prev = (await db.saved.get(savedKey(kind, placeGuess, titleGuess))) ?? (await db.saved.get(savedKey(kind, undefined, q)));
        if (cancelled) return;
        setSplit(sp);
        setResults(found);
        setSavedHit(
          prev
            ? {
                id: "saved", label: `이전 기록 · ${prev.place ? prev.place + " " : ""}${prev.title}`, title: prev.title, place: prev.place,
                source: "saved", baseGrams: prev.items[0]?.grams ?? null, grams: prev.items[0]?.grams ?? null, nutrients: prev.total,
              }
            : null,
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy((b) => (b === "db" ? "" : b));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, kind]);

  // 상세를 고르면 화면을 내려서 영양성분과 저장 버튼이 보이게
  useEffect(() => {
    if (choice) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [choice?.id]);

  /** AI에 넘길 상호/메뉴: DB에 있는 업체면 그걸로, 아니면 외식은 첫 단어를 상호로 */
  const placeAndTitle = (): { place?: string; title: string } => {
    const q = query.trim();
    if (split.brand) return { place: split.brand, title: split.rest || q };
    if (kind === "out" && q.includes(" ")) {
      const [first, ...rest] = q.split(/\s+/);
      return { place: first, title: rest.join(" ") };
    }
    return { title: q };
  };

  const runAi = async () => {
    setBusy("ai");
    setError("");
    try {
      const { place, title } = placeAndTitle();
      const refs = results.slice(0, 5).map((f) => `${foodLabel(f)}: ${f.per100.kcal}kcal, 탄${f.per100.carb} 단${f.per100.protein} 지${f.per100.fat}, 나트륨${f.per100.sodium}mg${f.serving ? `, 1회 ${f.serving}g` : ""}`);
      const est = await estimateMenu(settings, place ?? "", title, copy.amount, refs, kind);
      const c: Choice = {
        id: "ai", label: `AI 추정 · ${est.name}`, title, place, source: "ai",
        baseGrams: est.grams || null, grams: est.grams || null, nutrients: est.nutrients, note: est.note,
      };
      setAiChoice(c);
      setChoice(c);
    } catch (e) {
      setError(e instanceof GeminiError ? e.message : "AI 추정에 실패했어요.");
    } finally {
      setBusy("");
    }
  };

  const pickFood = (f: Food, i: number) => setChoice(foodChoice(f, i));

  const foodChoice = (f: Food, i: number): Choice => {
    const grams = listGrams(f);
    // 저장 이름은 DB 이름 (같은 검색의 여러 결과가 서로 다른 메뉴로 저장되게).
    // 상호는 DB 업체명, 없으면 외식은 입력한 상호
    const { place } = placeAndTitle();
    return {
      id: `db${i}`,
      label: foodLabel(f),
      title: f.name.replace(/_/g, " "),
      place: f.brand || (kind === "out" ? place : undefined),
      source: "db", matchName: f.name, per100: f.per100, baseGrams: grams, grams,
      nutrients: scaleNutrients(f.per100, grams / 100),
      note: f.partial ? "식약처 DB에 탄수화물·지방 값이 없는 메뉴예요. 알고 있으면 직접 고쳐 주세요." : undefined,
    };
  };

  const setGrams = (g: number | null) => {
    if (!choice) return;
    if (choice.per100) setChoice({ ...choice, grams: g, nutrients: scaleNutrients(choice.per100, (g ?? 0) / 100) });
    else if (choice.grams && g) setChoice({ ...choice, grams: g, nutrients: scaleNutrients(choice.nutrients, g / choice.grams) });
    else setChoice({ ...choice, grams: g });
  };

  /** 저장·즐겨찾기에 쓰는 내용 */
  const toDraft = (c: Choice): Draft => {
    const title = c.title || query.trim();
    return {
      kind,
      title,
      place: c.place,
      items: [{
        name: title,
        amountText: c.grams ? `${Math.round(c.grams)}g` : "",
        grams: c.grams, source: c.source, matchName: c.matchName, nutrients: c.nutrients,
      }],
    };
  };

  const save = () => {
    if (choice) onSave(toDraft(choice));
  };

  const q = query.trim();
  return (
    <div className="form">
      <input
        className="search-input"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setChoice(null); setError(""); }}
        placeholder={copy.placeholder}
        enterKeyHint="search"
        autoFocus
      />
      {kind === "out" && split.brand && q && <p className="muted small">상호 <b>{split.brand}</b> · 메뉴 <b>{split.rest || "—"}</b></p>}
      {error && <p className="error">{error}</p>}

      {q && (
        <div className="results">
          {savedHit && <ResultButton label={savedHit.label} n={savedHit.nutrients} selected={choice?.id === "saved"} onClick={() => setChoice(savedHit)} fav={() => toDraft(savedHit)} />}
          {aiChoice && <ResultButton label={aiChoice.label} n={aiChoice.nutrients} note={aiChoice.note} selected={choice?.id === "ai"} onClick={() => setChoice(aiChoice)} fav={() => toDraft(aiChoice)} />}
          {results.map((f, i) => (
            <ResultButton
              key={`${f.name}|${f.brand}|${i}`}
              label={foodLabel(f)}
              n={scaleNutrients(f.per100, listGrams(f) / 100)}
              suffix={`${listGrams(f)}g`}
              selected={choice?.id === `db${i}`}
              onClick={() => pickFood(f, i)}
              fav={() => toDraft(foodChoice(f, i))}
            />
          ))}
          {!busy && results.length === 0 && !aiChoice && <p className="muted small">{copy.empty}</p>}
          {!aiChoice && settings.geminiKey && (
            <button className="block" onClick={runAi} disabled={busy === "ai"}>
              {busy === "ai" ? "AI가 찾는 중..." : "AI로 찾기"}
            </button>
          )}
        </div>
      )}

      {choice && (
        <div className="card inset detail" ref={detailRef}>
          <div className="detail-head">
            <p className="small"><b>{choice.label}</b></p>
            <FavStar getDraft={() => toDraft(choice)} />
          </div>
          {choice.note && <p className="muted small">{choice.note}</p>}
          <div className="amount-row">
            <label className="inline">먹은 양
              <NumInput value={choice.grams} onChange={setGrams} placeholder="g" />
              <span className="muted">g</span>
            </label>
            {choice.baseGrams ? (
              <Stepper
                value={(choice.grams ?? 0) / choice.baseGrams}
                onChange={(k) => setGrams(Math.round(choice.baseGrams! * k * 10) / 10)}
              />
            ) : (
              // 중량을 모르는 값(일부 AI·이전 기록)은 영양성분을 그대로 배수
              <Stepper
                value={choice.k ?? 1}
                onChange={(k) => {
                  const base = choice.base ?? choice.nutrients; // ×1일 때 값
                  setChoice({ ...choice, k, base, nutrients: scaleNutrients(base, k) });
                }}
              />
            )}
          </div>
          <NutrientEditor n={choice.nutrients} onChange={(n) => setChoice({ ...choice, nutrients: n, per100: undefined, k: undefined, base: undefined })} />
          <button className="primary block" onClick={save}>저장</button>
        </div>
      )}
    </div>
  );
}

function ResultButton({ label, n, note, suffix, selected, onClick, fav }: {
  label: string; n: Nutrients; note?: string; suffix?: string; selected: boolean; onClick: () => void; fav?: () => FavDraft | null;
}) {
  return (
    <div className="result-row">
      <button className={`result ${selected ? "selected" : ""}`} onClick={onClick}>
        <div>{label}</div>
        <NutrientLine n={n} />
        {suffix && <span className="muted small"> ({suffix})</span>}
        {note && <div className="muted small">{note}</div>}
      </button>
      {fav && <FavStar getDraft={fav} className="result-star" />}
    </div>
  );
}
