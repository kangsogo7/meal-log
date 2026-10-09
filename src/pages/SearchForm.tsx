// 외식 / 식품 공통: 입력칸 하나 → 목록 → 누르면 영양성분 상세 + 저장
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, savedKey, setKV, scaleNutrients, type ItemSource, type Nutrients } from "../db";
import { foodLabel, listGrams, loadFoodDb, loadProductDb, parseSize, searchFoods, splitBrand, type Food } from "../foodDb";
import { estimateMenu, formatTrace, GeminiError, getLastTrace, type MenuEstimate } from "../gemini";
import { runInBackground, useJob } from "../bgJobs";
import { useSettings } from "../hooks";
import { NutrientEditor, NutrientLine } from "../components/ui";
import { AmountEditor, makePortion, storedPortion, portionGrams, portionNutrients, withNutrients, type Portion } from "../portion";
import type { Draft } from "./AddSheet";
import { FavStar, type FavDraft } from "../favorites";

interface Choice {
  id: string;
  label: string;
  title: string; // 저장할 이름
  place?: string; // 저장할 상호/제조사
  source: ItemSource;
  matchName?: string;
  portion: Portion; // 먹은 양 (공통 양 조절)
  note?: string;
  verified?: boolean; // AI가 구글 검색으로 공식 정보를 확인했는지
}

const COPY = {
  out: { placeholder: "상호 메뉴명 (예: 교촌치킨 허니콤보)", amount: "1인분", empty: "검색 결과가 없어요" },
  food: { placeholder: "식품 이름 (예: 그릭요거트, 바나나)", amount: "1개 (1회 제공량)", empty: "검색 결과가 없어요" },
};

/** AI 결과는 검색어별로 저장 (요청 중에 화면을 떠났다 와도, 앱이 다시 시작돼도 결과가 남아 있게) */
interface AiSaved { est: MenuEstimate; place?: string; title: string; time: string; at: number }
const aiKey = (kind: string, q: string, search: boolean) => `aiMenu:${kind}|${q.trim().replace(/s+/g, " ").toLowerCase()}|${search ? 1 : 0}`;

export default function SearchForm({ kind, onSave, initialQuery = "", onQueryChange }: {
  kind: "out" | "food"; onSave: (d: Draft) => void; initialQuery?: string; onQueryChange?: (q: string) => void;
}) {
  const settings = useSettings();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Food[]>([]);
  const [split, setSplit] = useState<{ brand?: string; rest: string }>({ rest: "" });
  const [savedHit, setSavedHit] = useState<Choice | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState<"" | "db">("");
  const [error, setError] = useState("");
  // AI 요청은 뒤에서 진행 (홈 화면에 갔다 오거나 폰을 잠가도 돌아오면 이어서)
  const fastJob = useJob(aiKey(kind, query, false));
  const verifyJob = useJob(aiKey(kind, query, true));
  const fastSaved = useLiveQuery(() => (query.trim() ? getKV<AiSaved | null>(aiKey(kind, query, false), null) : null), [kind, query]);
  const verifySaved = useLiveQuery(() => (query.trim() ? getKV<AiSaved | null>(aiKey(kind, query, true), null) : null), [kind, query]);
  const aiSaved = verifySaved ?? fastSaved ?? null;
  const aiChoice = useMemo<Choice | null>(
    () => aiSaved ? {
      id: "ai", label: `AI 추정 · ${aiSaved.est.name}`, title: aiSaved.title, place: aiSaved.place, source: "ai",
      verified: !!verifySaved, portion: makePortion(aiSaved.est.nutrients, aiSaved.est.grams), note: aiSaved.est.note,
    } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiSaved?.at, !!verifySaved],
  );
  const aiTime = aiSaved?.time ?? "";
  const aiError = fastJob.error || verifyJob.error;
  useEffect(() => onQueryChange?.(query), [query]);
  // 방금 요청한 AI 결과가 오면 바로 상세를 보여 줌 (다른 결과를 골라 둔 경우는 그대로)
  const askedAt = useRef(0);
  useEffect(() => {
    if (aiChoice && aiSaved && aiSaved.at >= askedAt.current && askedAt.current > 0) setChoice((c) => (!c || c.id === "ai" ? aiChoice : c));
  }, [aiChoice]);
  const detailRef = useRef<HTMLDivElement>(null);
  const copy = COPY[kind];

  // 입력할 때마다 식약처 DB 검색 (기기 안에서 하므로 빠름)
  useEffect(() => {
    const q = query.trim();
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
                source: "saved", portion: storedPortion(prev),
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

  // 상세를 고르면, 상세가 화면 밖에 있을 때만 보일 만큼만 내림
  useEffect(() => {
    if (choice) detailRef.current?.scrollIntoView({ block: "nearest" });
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

  /** search: 구글 검색으로 공식 영양정보 확인 (느림). 기본은 빠른 답 */
  const runAi = (search = false) => {
    setError("");
    askedAt.current = Date.now();
    const key = aiKey(kind, query, search);
    const { place, title } = placeAndTitle();
    // 사이즈는 메뉴 이름에서 떼어 "먹은 양"으로 (예: "아이스말차 L사이즈" → 메뉴 "아이스말차", 양 "L 사이즈 1잔")
    const { label: size, text: menu } = parseSize(title);
    const amount = size ? `${size} 사이즈 1잔` : copy.amount;
    runInBackground(
      key,
      async () => {
        const t0 = performance.now();
        const est = await estimateMenu(settings, place ?? "", menu || title, amount, kind, search);
        const time = `총 ${((performance.now() - t0) / 1000).toFixed(1)}초 (${formatTrace(getLastTrace())})`;
        await setKV(key, { est, place, title, time, at: Date.now() } satisfies AiSaved);
      },
      { done: "AI 검색 결과가 도착했어요", fail: (e) => (e instanceof GeminiError ? e.message : "AI 추정에 실패했어요.") },
    );
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
      source: "db", matchName: f.name,
      portion: makePortion(scaleNutrients(f.per100, grams / 100), grams),
      note: f.partial ? "식약처 DB에 탄수화물·지방 값이 없는 메뉴예요. 알고 있으면 직접 고쳐 주세요." : undefined,
    };
  };

  /** 저장·즐겨찾기에 쓰는 내용 */
  const toDraft = (c: Choice): Draft => {
    const title = c.title || query.trim();
    const grams = portionGrams(c.portion);
    return {
      kind,
      title,
      place: c.place,
      items: [{
        name: title,
        amountText: grams ? `${grams}g` : "",
        grams, source: c.source, matchName: c.matchName, nutrients: portionNutrients(c.portion),
      }],
      k: c.portion.k,
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
      />
      {kind === "out" && split.brand && q && <p className="muted small">상호 <b>{split.brand}</b> · 메뉴 <b>{split.rest || "—"}</b></p>}
      {error && <p className="error">{error}</p>}
      {aiError && <p className="error">{aiError}</p>}

      {q && (
        <div className="results">
          {savedHit && <ResultButton label={savedHit.label} n={portionNutrients(savedHit.portion)} selected={choice?.id === "saved"} onClick={() => setChoice(savedHit)} fav={() => toDraft(savedHit)} />}
          {aiChoice && <ResultButton label={aiChoice.label} n={portionNutrients(aiChoice.portion)} note={aiChoice.note} selected={choice?.id === "ai"} onClick={() => setChoice(aiChoice)} fav={() => toDraft(aiChoice)} />}
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
            <button className="block" onClick={() => runAi()} disabled={fastJob.running}>
              {fastJob.running ? "AI가 찾는 중... (다른 앱을 써도 돼요)" : "AI로 찾기"}
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
          {choice.id === "ai" && aiTime && <p className="muted small">{aiTime}</p>}
          {choice.id === "ai" && !choice.verified && (
            <button className="link small verify-btn" onClick={() => runAi(true)} disabled={verifyJob.running}>
              {verifyJob.running ? "공식 정보 찾는 중... (10초 이상 걸릴 수 있어요)" : "공식 정보로 다시 찾기 (느림)"}
            </button>
          )}
          <AmountEditor portion={choice.portion} onChange={(portion) => setChoice({ ...choice, portion })} />
          <NutrientEditor n={portionNutrients(choice.portion)} onChange={(n) => setChoice({ ...choice, portion: withNutrients(choice.portion, n) })} />
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
