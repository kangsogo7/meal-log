// 음식 검색 (가게 메뉴·식품 한 번에): 입력칸 하나 → 목록 → 누르면 영양성분 상세 + 저장
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, setKV, scaleNutrients, sourceLabel, type Item, type ItemSource, type Nutrients } from "../db";
import { foodLabel, listGrams, loadFoodDb, loadProductDb, searchFoods, splitBrand, type Food } from "../foodDb";
import { askFood, formatTrace, GeminiError, getLastTrace, type MenuEstimate } from "../gemini";
import { runInBackground, useJob } from "../bgJobs";
import { useSettings } from "../hooks";
import { DataNote, NutrientEditor, NutrientLine, SourceLinks, SrcTag } from "../components/ui";
import { AmountEditor, makePortion, storedPortion, portionGrams, portionNutrients, withNutrients, type Portion } from "../portion";
import type { Draft } from "./AddSheet";
import { FavStar, type FavDraft } from "../favorites";
import { rankUserFoods } from "../userFoods";
import AiSheet from "../components/AiSheet";

interface Choice {
  id: string;
  kind: "out" | "food"; // 기록 종류 (가게 메뉴 / 식품) — 결과마다 자동으로
  label: string;
  title: string; // 저장할 이름
  place?: string; // 저장할 상호/제조사
  source: ItemSource;
  via?: Item["via"];
  matchName?: string;
  portion: Portion; // 먹은 양 (공통 양 조절)
  note?: string;
}

const PLACEHOLDER = "가게 메뉴·식품 (예: 교촌치킨 허니콤보, 바나나)";

/** AI 결과는 검색어별로 저장 (요청 중에 화면을 떠났다 와도, 앱이 다시 시작돼도 결과가 남아 있게) */
interface AiSaved { est: MenuEstimate; kind?: "out" | "food"; place?: string; title: string; time: string; at: number; prompt?: string }
const aiKey = (q: string, search: boolean) => `aiMenu:all|${q.trim().replace(/\s+/g, " ").toLowerCase()}|${search ? 1 : 0}`;

export default function SearchForm({ onSave, initialQuery = "", onQueryChange, actionLabel = "저장", autoFocus }: {
  onSave: (d: Draft) => void; initialQuery?: string; onQueryChange?: (q: string) => void; actionLabel?: string;
  /** 사용자가 검색칸을 눌러 들어온 경우에만 바로 입력 */
  autoFocus?: boolean;
}) {
  const settings = useSettings();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Food[]>([]);
  // 가게(식약처 DB 업체) 또는 제조사(제품 DB)로 알아본 상호
  const [split, setSplit] = useState<{ brand?: string; rest: string; shop?: boolean }>({ rest: "" });
  const [savedHits, setSavedHits] = useState<Choice[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState<"" | "db">("");
  const [error, setError] = useState("");
  // AI에게 보낼 질문 (null이면 질문칸을 닫은 상태). 처음엔 검색어로 채워 줌
  const [prompt, setPrompt] = useState<string | null>(null);
  // AI 요청은 뒤에서 진행 (홈 화면에 갔다 오거나 폰을 잠가도 돌아오면 이어서)
  // AI는 항상 구글 검색으로 최신 공식 정보를 찾아서 답함
  const aiJob = useJob(aiKey(query, true));
  const aiSaved = useLiveQuery(() => (query.trim() ? getKV<AiSaved | null>(aiKey(query, true), null) : null), [query]) ?? null;
  const aiChoice = useMemo<Choice | null>(
    () => aiSaved ? {
      id: "ai", kind: aiSaved.kind ?? "out", label: `AI 답 · ${aiSaved.est.name}`, title: aiSaved.title, place: aiSaved.place, source: "ai", via: !aiSaved.est.sources ? undefined : aiSaved.est.sources.length ? "web" : "guess", portion: makePortion(aiSaved.est.nutrients, aiSaved.est.grams), note: aiSaved.est.note,
    } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiSaved?.at, aiSaved?.title],
  );
  const aiError = aiJob.error;
  useEffect(() => onQueryChange?.(query), [query]);
  // AI 창: ask = 질문 입력, result = 결과 (보내면 결과 화면에서 기다림). aiPick은 결과에서 고친 양·영양성분
  const [aiView, setAiView] = useState<null | "ask" | "result">(null);
  const [aiPick, setAiPick] = useState<Choice | null>(null);
  // 방금 요청한 AI 결과가 오면 결과 화면에 그 결과를
  const askedAt = useRef(0);
  useEffect(() => {
    if (aiChoice && aiSaved && aiSaved.at >= askedAt.current && askedAt.current > 0) {
      askedAt.current = 0;
      setAiPick(aiChoice);
    }
  }, [aiChoice]);
  /** 이전 답이 있으면 결과부터, 없으면 질문부터 */
  const openAi = () => {
    if (aiChoice && !aiJob.running) {
      setAiPick(aiChoice);
      setAiView("result");
    } else {
      setPrompt(aiSaved?.prompt ?? query.trim());
      setAiView(aiJob.running ? "result" : "ask");
    }
  };
  const reAsk = () => {
    setPrompt(aiSaved?.prompt ?? query.trim());
    setAiView("ask");
  };
  const detailRef = useRef<HTMLDivElement>(null);

  // 입력할 때마다 식약처 DB 검색 (기기 안에서 하므로 빠름)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setSavedHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setBusy((b) => b || "db");
        const base = await loadFoodDb();
        const prods = await loadProductDb();
        // 가게 메뉴: 상호를 알아보면 그 가게 메뉴부터
        const shop = splitBrand(base, q);
        let menus = shop.brand && shop.rest ? searchFoods(base, shop.rest, { prefer: "dish", brand: shop.brand, limit: 8 }) : [];
        if (menus.length < 3) menus = [...new Set([...menus, ...searchFoods(base, shop.rest || q, { prefer: "dish", limit: 8 })])].slice(0, 8);
        // 식품: 제조사를 알아보면 그 회사 제품부터
        const maker = splitBrand(prods, q);
        let products = searchFoods(prods, maker.rest || q, { brand: maker.brand, limit: 8 });
        if (maker.brand && products.length === 0) products = searchFoods(prods, q, { limit: 8 });
        // 과일·우유 같은 일반 식품: 이름이 검색어로 시작할 때만 맨 위에
        const head = q.split(/\s+/)[0];
        const plain = shop.brand || maker.brand ? [] : searchFoods(base.filter((f) => f.kind === 0), q, { prefer: "ingredient", limit: 4 });
        const strong = q.includes(" ") ? [] : plain.filter((f) => f.name.startsWith(head));
        // 알아본 상호 쪽을 먼저, 아니면 메뉴·제품을 번갈아
        const mix = shop.brand ? [...menus, ...products] : maker.brand ? [...products, ...menus] : menus.flatMap((m, i) => [m, products[i]]).concat(products.slice(menus.length)).filter(Boolean);
        const found = [...new Set([...strong.slice(0, 2), ...mix, ...plain])].slice(0, 12);
        const sp = shop.brand ? { ...shop, shop: true } : maker.brand ? maker : { rest: q };
        // 즐겨찾기·이전 기록 중 비슷한 것 전부를 DB 목록보다 위에 (즐겨찾기 → 이전 기록)
        const prev = rankUserFoods((await db.saved.toArray()).map((s) => ({ s, name: s.title, place: s.place, fav: s.groupId != null, at: s.updatedAt })), q);
        if (cancelled) return;
        setSplit(sp);
        setResults(found);
        setSavedHits(prev.map(({ s, fav }, i) => ({
          id: `saved${i}`, label: `${fav ? "★ " : "이전 기록 · "}${s.place ? s.place + " " : ""}${s.title}`, title: s.title, place: s.place,
          kind: s.kind === "out" ? "out" : "food", source: "saved", portion: storedPortion(s),
        })));
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
  }, [query]);

  // 상세를 고르면, 상세가 화면 밖에 있을 때만 보일 만큼만 내림
  useEffect(() => {
    if (choice) detailRef.current?.scrollIntoView({ block: "nearest" });
  }, [choice?.id]);

  /** AI에 넘길 상호/메뉴: DB에 있는 가게·제조사면 그걸로 */
  const placeAndTitle = (): { place?: string; title: string } => {
    const q = query.trim();
    if (split.brand) return { place: split.brand, title: split.rest || q };
    return { title: q };
  };

  const runAi = () => {
    const text = prompt?.trim() || query.trim();
    if (!text) return;
    setError("");
    setPrompt(null);
    askedAt.current = Date.now();
    const key = aiKey(query, true);
    const { place, title } = placeAndTitle();
    const kind = split.brand && !split.shop ? "food" : "out";
    runInBackground(
      key,
      async () => {
        const t0 = performance.now();
        const est = await askFood(settings, text);
        const time = `총 ${((performance.now() - t0) / 1000).toFixed(1)}초 (${formatTrace(getLastTrace())})`;
        await setKV(key, { est, kind, place, title, time, at: Date.now(), prompt: text } satisfies AiSaved);
      },
      { done: "AI 검색 결과가 도착했어요", fail: (e) => (e instanceof GeminiError ? e.message : "AI 추정에 실패했어요.") },
    );
  };

  const pickFood = (f: Food, i: number) => setChoice(foodChoice(f, i));

  const foodChoice = (f: Food, i: number): Choice => {
    const grams = listGrams(f);
    // 저장 이름은 DB 이름 (같은 검색의 여러 결과가 서로 다른 메뉴로 저장되게). 상호는 DB 업체명·제조사
    return {
      id: `db${i}`,
      kind: f.kind === 1 ? "out" : "food",
      label: foodLabel(f),
      title: f.name.replace(/_/g, " "),
      place: f.brand || undefined,
      source: "db", matchName: f.name,
      portion: makePortion(scaleNutrients(f.per100, grams / 100), grams),
      note: f.partial ? "식약처 DB에 탄수화물·지방 값이 없어서, 이 메뉴의 칼로리·단백질·포화지방과 같은 종류 음식의 비율로 추정했어요. 더 정확한 값은 AI로 찾기를 눌러 보세요." : undefined,
    };
  };

  /** 저장·즐겨찾기에 쓰는 내용 */
  const toDraft = (c: Choice): Draft => {
    const title = c.title || query.trim();
    const grams = portionGrams(c.portion);
    return {
      kind: c.kind,
      title,
      place: c.place,
      items: [{
        name: title,
        amountText: grams ? `${grams}g` : "",
        grams, source: c.source, via: c.via, matchName: c.matchName, nutrients: portionNutrients(c.portion),
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
        onChange={(e) => { setQuery(e.target.value); setChoice(null); setError(""); setPrompt(null); }}
        placeholder={PLACEHOLDER}
        enterKeyHint="search"
        autoFocus={autoFocus}
      />
      {split.shop && split.brand && q && <p className="muted small">상호 <b>{split.brand}</b> · 메뉴 <b>{split.rest || "—"}</b></p>}
      {error && <p className="error">{error}</p>}

      {q && (
        <div className="results">
          {settings.geminiKey && (
            <button className="result ai-row" onClick={openAi}>
              <div><b>AI에게 묻기</b></div>
              <span className="muted small">
                {aiJob.running ? "찾는 중... (다른 앱을 써도 돼요)" : aiError ? aiError : aiChoice ? `이전 답 · ${aiSaved!.est.name} ${Math.round(portionNutrients(aiChoice.portion).kcal)}kcal` : "검색해서 영양정보를 찾아 줘요"}
              </span>
            </button>
          )}
          {savedHits.map((h) => (
            <ResultButton key={h.id} tag="내 기록" label={h.label} n={portionNutrients(h.portion)} selected={choice?.id === h.id} onClick={() => setChoice(h)} fav={() => toDraft(h)} />
          ))}
          {results.map((f, i) => (
            <ResultButton
              key={`${f.name}|${f.brand}|${i}`}
              tag="식약처"
              label={foodLabel(f)}
              n={scaleNutrients(f.per100, listGrams(f) / 100)}
              suffix={`${listGrams(f)}g`}
              selected={choice?.id === `db${i}`}
              onClick={() => pickFood(f, i)}
              fav={() => toDraft(foodChoice(f, i))}
            />
          ))}
          {!busy && results.length === 0 && savedHits.length === 0 && !aiChoice && <p className="muted small">검색 결과가 없어요</p>}
          {(results.length > 0 || savedHits.length > 0 || aiChoice) && <DataNote />}
        </div>
      )}

      {choice && (
        <div className="card inset detail" ref={detailRef}>
          <div className="detail-head">
            <p className="small"><b>{choice.label}</b><SrcTag label={sourceLabel(choice)} /></p>
            <FavStar getDraft={() => toDraft(choice)} />
          </div>
          {choice.note && <p className="muted small">{choice.note}</p>}
          <AmountEditor portion={choice.portion} onChange={(portion) => setChoice({ ...choice, portion })} />
          <NutrientEditor n={portionNutrients(choice.portion)} onChange={(n) => setChoice({ ...choice, source: "manual", via: undefined, portion: withNutrients(choice.portion, n) })} />
          <button className="primary block" onClick={save}>{actionLabel}</button>
        </div>
      )}

      {aiView && (
        <AiSheet
          view={aiView}
          prompt={prompt ?? ""}
          onPrompt={setPrompt}
          onSend={() => { runAi(); setAiPick(null); setAiView("result"); }}
          onClose={() => setAiView(null)}
          onReAsk={reAsk}
          waiting={aiJob.running}
          error={aiError || undefined}
          actionLabel={actionLabel}
          onAction={() => { if (aiPick) { setAiView(null); onSave(toDraft(aiPick)); } }}
          star={aiPick && <FavStar getDraft={() => toDraft(aiPick)} />}
        >
          {aiPick && (
            <>
              <div className="ai-answer">
                <div className="ai-name"><b>{aiSaved?.est.name ?? aiPick.title}</b><SrcTag label={sourceLabel(aiPick)} /></div>
                {aiPick.note && <p className="muted small">{aiPick.note}</p>}
                <SourceLinks sources={aiSaved?.est.sources} />
              </div>
              <AmountEditor portion={aiPick.portion} onChange={(portion) => setAiPick({ ...aiPick, portion })} />
              <NutrientEditor n={portionNutrients(aiPick.portion)} onChange={(n) => setAiPick({ ...aiPick, source: "manual", via: undefined, portion: withNutrients(aiPick.portion, n) })} />
            </>
          )}
        </AiSheet>
      )}
    </div>
  );
}

function ResultButton({ label, tag, n, note, suffix, selected, onClick, fav }: {
  label: string; tag?: string; n: Nutrients; note?: string; suffix?: string; selected: boolean; onClick: () => void; fav?: () => FavDraft | null;
}) {
  return (
    <div className="result-row">
      <button className={`result ${selected ? "selected" : ""}`} onClick={onClick}>
        <div>{label}{tag && <SrcTag label={tag} />}</div>
        <NutrientLine n={n} />
        {suffix && <span className="muted small"> ({suffix})</span>}
        {note && <div className="muted small">{note}</div>}
      </button>
      {fav && <FavStar getDraft={fav} className="result-star" />}
    </div>
  );
}
