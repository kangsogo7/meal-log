// 재료로 요리: 재료를 하나씩 검색해 추가(또는 입력칸 여러 개에 적어 한 번에) → 줄마다 g, 누르면 어떤 값으로 계산할지 고르기
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { db, scaleNutrients, sourceLabel, sumNutrients, ZERO, type Item, type Nutrients } from "../db";
import { foodLabel, loadFoodDb, searchFoods, type Food } from "../foodDb";
import { askFood, GeminiError, resolveIngredients, type MenuEstimate, type WebSource } from "../gemini";
import { useSettings } from "../hooks";
import { parseLines, type ParsedLine } from "../parse";
import { Btn, BtnRow, DataNote, flash, NumInput, revealInSheet, FullScreen, SourceLinks, NutrientEditor, TextInput } from "../components/ui";
import AiSheet, { type AiView } from "../components/AiSheet";
import FoodDetail from "../components/FoodDetail";
import { makePortion, portionGrams, portionNutrients, type Portion } from "../portion";
import type { Draft } from "./AddSheet";
import { FavStar } from "../favorites";
import { norm, rankUserFoods, type UserFoodCand } from "../userFoods";

const AI = -1;
const MANUAL = -2;
/** 이전 기록·즐겨찾기 j번 = PREV - j */
const PREV = -10;

/** 예전에 먹은 것 (즐겨찾기 또는 이전 기록의 음식·재료) */
interface Prev { label: string; grams: number | null; nutrients: Nutrients; exact: boolean }

/** 재료의 g: 저장된 g, 없으면 적힌 양에서 ("1회 제공량(110g)" → 110) */
const itemGrams = (i: Item) => i.grams || Number(i.amountText.match(/(\d+(?:\.\d+)?)\s*g(?![a-z])/i)?.[1]) || null;

/** 재료와 비슷한 즐겨찾기·이전 기록 전부 (순서는 rankUserFoods: 즐겨찾기 → 이전 기록, 이름이 가까운 것 먼저) */
async function findPrev(names: string[]): Promise<Prev[][]> {
  const [saved, entries] = await Promise.all([db.saved.toArray(), db.entries.orderBy("createdAt").reverse().toArray()]);
  const pool: (Prev & UserFoodCand)[] = [];
  const seen = new Set<string>();
  for (const f of saved) {
    const name = `${f.place ? f.place + " " : ""}${f.title}`;
    const gs = f.items.map(itemGrams);
    const g = gs.every(Boolean) ? gs.reduce((a, x) => a! + x!, 0) : null;
    seen.add(norm(f.title));
    pool.push({ name: f.title, place: f.place, fav: f.groupId != null, at: f.updatedAt, label: `${f.groupId != null ? "★ " : ""}${name}`, grams: g, nutrients: f.total, exact: false });
  }
  // 조리로 기록한 재료 하나하나도 (같은 이름은 가장 최근 것만)
  for (const e of entries) {
    if (e.items.length < 2) continue;
    for (const i of e.items) {
      const key = norm(i.name);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({ name: i.name, fav: false, at: e.createdAt, label: i.name, grams: itemGrams(i), nutrients: i.nutrients, exact: false });
    }
  }
  return names.map((n) => rankUserFoods(pool, n).map(({ label, grams, nutrients, exact }) => ({ label, grams, nutrients, exact })));
}

interface Row {
  id: number;
  line: ParsedLine;
  candidates: Food[];
  prev: Prev[];
  choice: number; // 후보 인덱스 / AI / MANUAL / PREV - j
  grams: number | null;
  ai?: { grams: number; nutrients: Nutrients };
  manual: Nutrients;
  /** g이 저장 안 된 즐겨찾기·이전 기록을 고를 때 적혀 있던 g. 이 g을 그 음식 영양성분의 기준으로 보고 g을 고치면 비율대로 */
  prevBase?: number | null;
}

const prevOf = (r: Row) => (r.choice <= PREV ? r.prev[PREV - r.choice] : undefined);

function rowNutrients(r: Row): Nutrients {
  const p = prevOf(r);
  if (p) {
    const base = p.grams ?? r.prevBase;
    return base && r.grams ? scaleNutrients(p.nutrients, r.grams / base) : p.nutrients;
  }
  if (r.choice >= 0) return scaleNutrients(r.candidates[r.choice].per100, (r.grams ?? 0) / 100);
  if (r.choice === AI && r.ai) return r.ai.grams ? scaleNutrients(r.ai.nutrients, (r.grams ?? r.ai.grams) / r.ai.grams) : r.ai.nutrients;
  return r.manual;
}

/** 값을 바꿀 때: 즐겨찾기·이전 기록이면 그 g을 따르거나(g을 안 적었으면) 지금 g을 기준으로 */
function choose(r: Row, choice: number): Row {
  const p = choice <= PREV ? r.prev[PREV - choice] : undefined;
  return { ...r, choice, prevBase: p && !p.grams ? r.grams : undefined, ...(p && !r.grams && p.grams ? { grams: p.grams } : {}) };
}

/** 줄 아래 한 줄 설명: 어디 값인지 */
function sourceText(r: Row) {
  const p = prevOf(r);
  if (p) return `내 기록 · ${p.label}`;
  if (r.choice >= 0) return `식약처 · ${foodLabel(r.candidates[r.choice])}`;
  if (r.choice === AI) return "AI";
  return "직접 입력";
}

const needsGrams = (r: Row) => r.choice >= 0 && !r.grams;

let nextId = 1;

/** 한 줄 → 재료 (이름이 똑같은 즐겨찾기·이전 기록이 있으면 그걸, 아니면 식약처 첫 후보) */
function makeRow(line: ParsedLine, candidates: Food[], prev: Prev[], choice?: number): Row {
  const base: Row = { id: nextId++, line, candidates, prev, choice: MANUAL, grams: line.grams, manual: { ...ZERO } };
  const auto = choice ?? (prev[0]?.exact ? PREV : candidates.length ? 0 : MANUAL);
  return choose(base, auto);
}

const MANY_EXAMPLES = ["예: 닭가슴살 150g", "예: 현미밥 200g", "예: 올리브유 1큰술"];

export default function HomeForm({ onSave, actionLabel = "저장" }: { onSave: (d: Draft) => void; actionLabel?: string }) {
  const settings = useSettings();
  const [dish, setDish] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [add, setAdd] = useState("");
  const [sugg, setSugg] = useState<{ line: ParsedLine; candidates: Food[]; prev: Prev[] } | null>(null);
  /** 여러 재료 한 번에: 입력칸 옆 ＋로 칸을 늘리고, 칸마다 재료 하나 */
  const [many, setMany] = useState<string[] | null>(null);
  const setManyAt = (i: number, v: string) => setMany((m) => m && m.map((x, j) => (j === i ? v : x)));
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // AI가 검색에서 실제로 참고한 페이지 (비어 있으면 근거 없이 추정)
  const [aiSources, setAiSources] = useState<WebSource[] | undefined>();
  const addRef = useRef<HTMLInputElement>(null);
  // 재료 추가칸의 "AI에게 묻기" 창
  const [ai, setAi] = useState<{ line: ParsedLine; candidates: Food[]; prev: Prev[]; view: AiView; prompt: string; est?: MenuEstimate; portion?: Portion; error?: string; busy: boolean } | null>(null);
  // 합계·기록 막대는 화면 아래 칸(식단 기록 화면의 #add-foot)에 (입력칸을 가리거나 키보드에 따라 떠다니지 않게)
  const [footEl, setFootEl] = useState<Element | null>(null);
  useEffect(() => setFootEl(document.getElementById("add-foot")), []);

  // 재료 추가칸: 칠 때마다 내 기록·식약처에서 후보
  useEffect(() => {
    const line = parseLines(add)[0];
    if (!line) {
      setSugg(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const [list, [prev]] = await Promise.all([loadFoodDb(), findPrev([line.name])]);
      if (!cancelled) setSugg({ line, candidates: searchFoods(list, line.name, { prefer: "ingredient", limit: 8 }), prev });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [add]);

  const askAi = async (base: Row[]) => {
    const { answers, sources } = await resolveIngredients(settings, base.map((r) => ({ text: r.line.text, candidates: r.candidates.map(foodLabel) })));
    setAiSources(sources);
    return base.map((r, i) => {
      const a = answers[i];
      const grams = r.grams ?? r.line.grams ?? (a.grams || null);
      const ai = a.nutrients ? { ai: { grams: a.grams, nutrients: a.nutrients } } : {};
      // 이전 기록·즐겨찾기를 골라 둔 재료는 그대로 (AI 답은 고를 수 있게만)
      if (r.choice <= PREV) return { ...r, ...ai };
      if (a.match >= 0) return { ...r, ...ai, choice: a.match, grams };
      if (a.nutrients) return { ...r, ...ai, choice: AI, grams };
      return { ...r, grams };
    });
  };

  const update = (id: number, f: (r: Row) => Row) => setRows((rs) => rs.map((r) => (r.id === id ? f(r) : r)));

  /** 후보를 골라 한 줄 추가 */
  const pick = (choice: number) => {
    if (!sugg) return;
    setRows((rs) => [...rs, makeRow(sugg.line, sugg.candidates, sugg.prev, choice)]);
    setAdd("");
    setSugg(null);
    addRef.current?.focus();
    // 추가칸이 화면 밖으로 밀렸으면 보일 만큼만
    setTimeout(() => revealInSheet(addRef.current), 50);
  };

  const sendAi = async () => {
    if (!ai) return;
    const text = ai.prompt.trim();
    setAi({ ...ai, view: "result", busy: true, error: undefined, est: undefined });
    try {
      const est = await askFood(settings, text);
      // 적어 둔 g이 있으면 그 g으로 (AI 기준 g의 배수)
      const k = ai.line.grams && est.grams ? ai.line.grams / est.grams : 1;
      setAi((a) => a && { ...a, busy: false, est, portion: makePortion(est.nutrients, est.grams, k) });
    } catch (e) {
      setAi((a) => a && { ...a, busy: false, error: e instanceof GeminiError ? e.message : "AI 확인에 실패했어요." });
    }
  };
  /** AI 답 창에서 보고 고친 양·영양성분 그대로 재료 한 줄 추가 */
  const addAi = () => {
    if (!ai?.est || !ai.portion) return;
    const grams = portionGrams(ai.portion);
    setAiSources(ai.est.sources);
    setRows((rs) => [...rs, { ...makeRow(ai.line, ai.candidates, ai.prev, MANUAL), choice: AI, ai: { grams: grams ?? 0, nutrients: portionNutrients(ai.portion!) }, grams }]);
    setAi(null);
    setAdd("");
    setSugg(null);
  };

  /** 여러 줄 한 번에: 줄마다 자동으로 고르고, AI 키가 있으면 AI로 한 번 더 맞춰 봄 */
  const addMany = async () => {
    const lines = parseLines((many ?? []).filter((x) => x.trim()).join("\n"));
    if (!lines.length) return;
    setBusy(true);
    setError("");
    try {
      const [list, prevs] = await Promise.all([loadFoodDb(), findPrev(lines.map((l) => l.name))]);
      let next = lines.map((line, i) => makeRow(line, searchFoods(list, line.name, { prefer: "ingredient", limit: 8 }), prevs[i]));
      if (settings.geminiKey) {
        try {
          next = await askAi(next);
        } catch (e) {
          setError(e instanceof GeminiError ? `${e.message} (식약처 DB 값으로 넣었어요)` : "AI 확인에 실패해서 식약처 DB 값으로 넣었어요.");
        }
      }
      setRows((rs) => [...rs, ...next]);
      setMany(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 재료 하나를 AI에게 */
  const askOne = async (r: Row) => {
    setBusy(true);
    setError("");
    try {
      const [res] = await askAi([r]);
      if (!res.ai) throw new Error("AI가 값을 찾지 못했어요.");
      update(r.id, () => ({ ...res, choice: AI }));
    } catch (e) {
      setError(e instanceof GeminiError || e instanceof Error ? e.message : "AI 확인에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const items: Item[] = rows.map((r) => ({
    name: r.line.name,
    amountText: r.line.amountText || (r.grams ? `${r.grams}g` : ""),
    grams: r.grams,
    source: r.choice <= PREV ? "saved" : r.choice >= 0 ? "db" : r.choice === AI ? "ai" : "manual",
    ...(r.choice === AI ? { via: aiSources?.length ? ("web" as const) : ("guess" as const) } : {}),
    matchName: r.choice >= 0 ? r.candidates[r.choice].name : undefined,
    nutrients: rowNutrients(r),
  }));
  const total = sumNutrients(items.map((i) => i.nutrients));
  const missing = rows.some(needsGrams);
  const title = () => dish.trim() || items.map((i) => i.name).join(", ");
  const save = () => onSave({ kind: "home", title: title(), items });
  const openRow = rows.find((r) => r.id === open);

  return (
    <div className="form">
      <label>요리 이름
        <div className="input-with-star">
          <TextInput value={dish} onChange={setDish} placeholder="선택 · 예: 닭가슴살 볶음밥" />
          <FavStar getDraft={() => (rows.length && !missing ? { kind: "home", title: title(), items } : null)} />
        </div>
      </label>

      {rows.length > 0 && (
        <div className="ing-rows">
          <span className="muted small">재료 {rows.length}개</span>
          {rows.map((r, i) => (
            <div key={r.id} className="ing-row">
              <button className="ing-open" onClick={() => setOpen(r.id)}>
                <span>{r.line.name}</span>
                {needsGrams(r) ? (
                  <span className="small error-text">g을 넣어 주세요</span>
                ) : (
                  <span className="muted small">{Math.round(items[i].nutrients.kcal)}kcal · {sourceText(r)}</span>
                )}
              </button>
              <label className="inline ing-g">
                <NumInput value={r.grams} onChange={(g) => update(r.id, (x) => ({ ...x, grams: g }))} placeholder="g" decimals={1} className={needsGrams(r) ? "missing" : ""} />
                <em>g</em>
              </label>
              <button className="del-btn" aria-label={`${r.line.name} 빼기`} onClick={() => {
                setRows((rs) => rs.filter((x) => x.id !== r.id));
                flash(`${r.line.name} 뺐어요`, 4000, { label: "되돌리기", run: () => setRows((rs) => [...rs.slice(0, i), r, ...rs.slice(i)]) });
              }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {many === null ? (
        <>
          <div className="ing-add">
            <TextInput
              ref={addRef}
              value={add}
              onChange={setAdd}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !sugg) return;
                e.preventDefault();
                pick(sugg.prev[0] ? PREV : sugg.candidates.length ? 0 : MANUAL);
              }}
              placeholder="재료 추가 (예: 닭가슴살 150g)"
              enterKeyHint="done"
              aria-label="재료 추가"
            />
            <button className="ing-more" onClick={() => { setMany([add, ""]); setAdd(""); setSugg(null); }} aria-label="입력칸 하나 더">＋</button>
          </div>
          {sugg && (
            <div className="ing-sugg">
              {settings.geminiKey && (
                <button className="ing-ai" onClick={() => setAi({ ...sugg, view: "ask", prompt: sugg.line.text, busy: false })}><b>AI에게 묻기</b><span className="muted small">검색해서 찾아 줘요</span></button>
              )}
              {sugg.prev.slice(0, 5).map((p, j) => (
                <button key={`p${j}`} onClick={() => pick(PREV - j)}><span>{p.label}</span><span className="muted small">내 기록{p.grams ? ` · ${Math.round(p.grams)}g` : ""}</span></button>
              ))}
              {sugg.candidates.map((c, j) => (
                <button key={j} onClick={() => pick(j)}><span>{foodLabel(c)}</span><span className="muted small">식약처 · 100g당 {Math.round(c.per100.kcal)}</span></button>
              ))}
              <button onClick={() => pick(MANUAL)}><span>"{sugg.line.name}" 그대로 추가</span><span className="muted small">값은 나중에</span></button>
            </div>
          )}
        </>
      ) : (
        <div className="ing-many-box">
          {many.map((v, i) => (
            <div key={i} className="ing-add">
              <TextInput
                value={v}
                onChange={(v) => setManyAt(i, v)}
                placeholder={MANY_EXAMPLES[i] ?? "재료"}
                enterKeyHint="next"
                aria-label={`재료 ${i + 1}`}
                autoFocus={i === many.length - 1}
              />
              {i === many.length - 1 ? (
                <button className="ing-more" onClick={() => setMany([...many, ""])} aria-label="입력칸 하나 더">＋</button>
              ) : (
                <button className="ing-more del" onClick={() => setMany(many.filter((_, j) => j !== i))} aria-label={`재료 ${i + 1} 칸 빼기`}>✕</button>
              )}
            </div>
          ))}
          <BtnRow>
            <Btn onClick={() => setMany(null)}>취소</Btn>
            <Btn kind="primary" onClick={addMany} disabled={!many.some((x) => x.trim()) || busy}>{busy ? "찾는 중..." : "한 번에 검색"}</Btn>
          </BtnRow>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {rows.length > 0 && (
        <>
          {rows.some((r) => r.choice === AI) && <SourceLinks sources={aiSources} />}
          <DataNote />
        </>
      )}
      {(() => {
        const foot = rows.length > 0 && (
          <div className="ing-foot">
            <div className="cart-sum">
              <b>합계 {Math.round(total.kcal).toLocaleString()}kcal</b>
              <span className="muted small">탄 {Math.round(total.carb)} · 단 {Math.round(total.protein)} · 지 {Math.round(total.fat)}</span>
            </div>
            <Btn kind="primary" className="cart-go" onClick={save} disabled={missing}>{actionLabel}</Btn>
          </div>
        );
        return footEl ? createPortal(foot, footEl) : foot;
      })()}

      {ai && (
        <AiSheet
          view={ai.view}
          prompt={ai.prompt}
          onPrompt={(prompt) => setAi({ ...ai, prompt })}
          onSend={sendAi}
          onClose={() => setAi(null)}
          onReAsk={() => setAi({ ...ai, view: "ask" })}
          waiting={ai.busy}
          error={ai.error}
          actionLabel="재료로 추가"
          onAction={addAi}
        >
          {ai.est && ai.portion && (
            <FoodDetail
              title={ai.est.name}
              tag={sourceLabel({ source: "ai", via: ai.est.sources?.length ? "web" : "guess" })}
              note={ai.est.note}
              sources={ai.est.sources ?? []}
              portion={ai.portion}
              onPortion={(portion) => setAi({ ...ai, portion })}
            />
          )}
        </AiSheet>
      )}

      {openRow && (
        <FullScreen title={openRow.line.text} onClose={() => setOpen(null)}>
          <div className="form">
            <label className="inline ing-g big">먹은 양
              <NumInput value={openRow.grams} onChange={(g) => update(openRow.id, (x) => ({ ...x, grams: g }))} placeholder="g" decimals={1} className={needsGrams(openRow) ? "missing" : ""} />
              <em>g</em>
            </label>
            {prevOf(openRow) && !prevOf(openRow)!.grams && (
              <p className="muted small">{openRow.prevBase ? `g이 저장되지 않은 음식이라, 고를 때의 ${openRow.prevBase}g을 기준으로 계산해요` : "g이 저장되지 않은 음식이라 저장된 영양성분 그대로예요"}</p>
            )}
            <span className="muted small">어떤 값으로 계산할까요</span>
            <div className="ing-opts" role="radiogroup">
              {openRow.prev.map((p, j) => (
                <Opt key={`p${j}`} on={openRow.choice === PREV - j} label={p.label} sub="내 기록" kcal={rowNutrients(choose(openRow, PREV - j)).kcal} onClick={() => update(openRow.id, (x) => choose(x, PREV - j))} />
              ))}
              {openRow.candidates.map((c, j) => (
                <Opt key={j} on={openRow.choice === j} label={foodLabel(c)} sub="식약처" kcal={openRow.grams ? rowNutrients(choose(openRow, j)).kcal : undefined} onClick={() => update(openRow.id, (x) => choose(x, j))} />
              ))}
              {openRow.ai ? (
                <Opt on={openRow.choice === AI} label="AI 값" sub={sourceLabel({ source: "ai", via: aiSources?.length ? "web" : "guess" })} kcal={rowNutrients(choose(openRow, AI)).kcal} onClick={() => update(openRow.id, (x) => choose(x, AI))} />
              ) : settings.geminiKey ? (
                <Opt on={false} label={busy ? "AI가 찾는 중..." : "AI에게 묻기"} sub="검색해서 찾아 줘요" onClick={() => !busy && askOne(openRow)} />
              ) : null}
              <Opt on={openRow.choice === MANUAL} label="숫자 직접 입력" onClick={() => update(openRow.id, (x) => choose(x, MANUAL))} />
            </div>
            {openRow.choice === MANUAL && <NutrientEditor n={openRow.manual} onChange={(n) => update(openRow.id, (x) => ({ ...x, manual: n }))} />}
            {openRow.choice === AI && <SourceLinks sources={aiSources} />}
            {error && <p className="error">{error}</p>}
            <BtnRow>
              <button className="danger-text" onClick={() => { setRows((rs) => rs.filter((r) => r.id !== openRow.id)); setOpen(null); }}>빼기</button>
              <Btn kind="primary" onClick={() => setOpen(null)}>확인</Btn>
            </BtnRow>
          </div>
        </FullScreen>
      )}
    </div>
  );
}

/** 값 고르기 한 줄 (라디오처럼) */
function Opt({ on, label, sub, kcal, onClick }: { on: boolean; label: string; sub?: string; kcal?: number; onClick: () => void }) {
  return (
    <button role="radio" aria-checked={on} className={`ing-opt ${on ? "on" : ""}`} onClick={onClick}>
      <span className="ing-dot" aria-hidden />
      <span className="ing-opt-text"><span>{label}</span>{sub && <span className="muted small">{sub}</span>}</span>
      {kcal != null && <b className="small">{Math.round(kcal).toLocaleString()}</b>}
    </button>
  );
}
