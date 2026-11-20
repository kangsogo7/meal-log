// Google Gemini API (REST generateContent) 호출
import { getKV, setKV, type Nutrients, type Settings } from "./db";

export class GeminiError extends Error {}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** responseSchema는 OpenAPI 형식이라 type을 대문자(OBJECT, NUMBER...)로 보냄 */
function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (s && typeof s === "object") {
    return Object.fromEntries(
      Object.entries(s).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toUpperCase() : toGeminiSchema(v)]),
    );
  }
  return s;
}

// ---------- AI 사용 기록 (기능별 실제 1회 비용을 재기 위해) ----------
export type AiKind = "menu" | "ingredients" | "photo" | "inbody" | "weekly";
export const AI_KIND_LABEL: Record<AiKind, string> = {
  menu: "음식명 AI 검색",
  ingredients: "집밥 재료 계산",
  photo: "사진 분석",
  inbody: "인바디 읽기",
  weekly: "주간 한마디",
};
/** 성공한 호출 1번: 입력·출력(생각 포함) 토큰, 구글 검색 횟수 */
export interface AiUsage { at: number; kind: AiKind; model: string; inTok: number; outTok: number; thinkTok?: number; searches: number; /** 실제로 붙여 보낸 생각 수준 ("none" = 모델이 거절해서 빼고 보냄) */ think?: string; /** 생각 설정을 거절한 이유 (구글 오류 문구) */ thinkErr?: string }
const USAGE_KEY = "aiUsage";
const USAGE_MAX = 500;

/** 100만 토큰당 달러 (입력, 출력). 2026-11 공식 가격표·발표 기준, 3.8 Flash는 2027년 가격. 모르는 모델은 비용 계산에서 뺌 */
const PRICE: Record<string, [number, number]> = {
  "gemini-3.8-flash": [1.5, 7.5],
  "gemini-4-hydrogen": [1.5, 7.5],
  "gemini-3.5-flash-lite": [0.3, 2.5],
  "gemini-3.1-flash-lite": [0.25, 1.5],
};
/** 구글 검색 1번 (무료분 넘은 뒤) */
const SEARCH_USD = 0.014;
export const KRW_PER_USD = 1400;

/** 유료 키였다면 이 호출에 든 돈 (원). 가격을 모르는 모델이면 검색비만 */
export function usageCostKrw(u: AiUsage): { krw: number; known: boolean } {
  const p = PRICE[u.model];
  const tok = p ? (u.inTok * p[0] + u.outTok * p[1]) / 1e6 : 0;
  return { krw: (tok + u.searches * SEARCH_USD) * KRW_PER_USD, known: !!p };
}

export const getUsage = () => getKV<AiUsage[]>(USAGE_KEY, []);
export const clearUsage = () => setKV(USAGE_KEY, []);

export function recordUsage(kind: AiKind, model: string, think: string, data: { usageMetadata?: Record<string, number>; candidates?: { groundingMetadata?: { webSearchQueries?: string[] } }[] }, thinkErr = "") {
  const m = data?.usageMetadata ?? {};
  const u: AiUsage = {
    at: Date.now(),
    kind,
    model,
    inTok: m.promptTokenCount ?? 0,
    outTok: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0),
    thinkTok: m.thoughtsTokenCount ?? 0,
    think,
    ...(thinkErr ? { thinkErr } : {}),
    searches: data?.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0,
  };
  getUsage()
    .then((list) => setKV(USAGE_KEY, [...list, u].slice(-USAGE_MAX)))
    .catch(() => {});
}

/** 마지막 요청이 어느 모델에 몇 번, 얼마나 걸렸는지 (느릴 때 원인 확인용) */
export interface TraceStep { model: string; status: number; ms: number; search: boolean; server?: boolean }
let lastTrace: TraceStep[] = [];
export const getLastTrace = () => lastTrace;
/** "4.2초 · gemini-3.8-flash" / 재시도가 있었으면 단계별로 */
export function formatTrace(t: TraceStep[]) {
  if (!t.length) return "";
  const total = t.reduce((a, s) => a + s.ms, 0);
  const steps = t.map((s) => `${s.model.replace("gemini-", "")}${s.search ? "(검색)" : ""} ${s.status === 200 ? "" : s.status === 598 ? "시간초과 " : s.status + " "}${(s.ms / 1000).toFixed(1)}초`).join(" → ");
  return `${(total / 1000).toFixed(1)}초 · ${steps}`;
}

/** 생각하기 최소 설정을 거절한 모델 (다음부터는 바로 빼고 보냄) */
const noFastThinking = new Set<string>();
/** 하루 요청 한도에 걸린 모델 → 다시 시도해 볼 시각 */
const dayLimited = new Map<string, number>();

// 3.7 Flash → 3.8, 3.5 Flash → 3.6으로 통합됨 (2026-10 구글 안내). 같은 모델로 다시 물어봐야 한도만 쓰므로 목록에서 뺌
/** 없어진 모델 → 넘어간 모델 */
const RENAMED: Record<string, string> = { "gemini-3.7-flash": "gemini-3.8-flash", "gemini-3.5-flash": "gemini-3.6-flash" };

// 4-hydrogen: 2026-11 출시, 정확도 비교용 (목록 맨 뒤라 다른 모델이 막혔을 때만 대신 쓰임)
/**
 * AI 호출 서버(functions/src/index.ts)를 쓸지. 서버를 배포하고 유료 키를 넣은 뒤 true로.
 * true면 키를 넣지 않은 사람은 서버로, 키를 넣은 사람은 지금처럼 폰에서 바로 불러요.
 */
export const AI_SERVER = false;
/** AI 기능을 쓸 수 있는지 (내 키가 있거나 서버가 켜져 있으면) */
export const aiReady = (s: Settings) => !!s.geminiKey || AI_SERVER;

// 기본은 3.8 Flash, 한도가 끝나면(429) 3.6 Flash로 이어서 (2026-11-18 사용자 요청)
export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-4-hydrogen"];


/** 물어볼 모델 순서. prefer: 간단한 작업은 설정한 모델 대신 가벼운 모델부터 (그 모델이 안 되면 나머지 모델로) */
export function modelOrder(settings: Settings, prefer: string[] = []): string[] {
  const order = [...prefer, RENAMED[settings.geminiModel] ?? settings.geminiModel, ...GEMINI_MODELS];
  const all = order.filter((m, i) => order.indexOf(m) === i);
  // 오늘 하루 한도를 다 쓴 모델은 건너뜀 (다 막혔으면 전부 다시 시도)
  const open = all.filter((m) => (dayLimited.get(m) ?? 0) < Date.now());
  return open.length ? open : all;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 구글이 보낸 오류 설명 (화면에 같이 보여 주기 위해) */
function googleMessage(body: string) {
  try {
    return (JSON.parse(body)?.error?.message as string | undefined)?.slice(0, 200) ?? "";
  } catch {
    return "";
  }
}

/** 붙여넣을 때 섞여 들어온 줄바꿈·보이지 않는 문자 제거 (헤더에 넣으면 요청이 실패함) */
export const cleanKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "");

/** 예전 키(AIza...) 또는 2026년 6월부터 발급되는 새 키(AQ....) 모양인지 */
export const looksLikeKey = (key: string) => /^(AIza[A-Za-z0-9_-]{35}|AQ\.[A-Za-z0-9._-]{20,})$/.test(key);

/** 답 글에서 JSON만 꺼냄 (```json 블록이나 앞뒤 설명이 섞여 와도) */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  return start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
}

/**
 * search: 구글 검색으로 공식 영양정보를 찾아보게 함.
 * 검색 도구를 쓰면 응답 형식(responseSchema)을 강제할 수 없어서, 형식은 글로 알려 주고 JSON만 골라 읽음.
 */
/** 구글 검색에서 실제로 참고한 웹페이지 (모델이 쓴 말이 아니라 응답의 검색 근거 정보) */
export interface WebSource { title: string; uri: string }

/** 구글 응답 한 번을 기다리는 최대 시간. 넘으면 붐빌 때처럼 다음 모델로 (응답이 안 와서 몇 분씩 멈춰 있지 않게) */
const CALL_MS = 60_000;

/** 답이 없을 때(시간 초과) 쓰는 상태 값 */
const TIMEOUT = 598;

async function generateJson<T>(settings: Settings, parts: Part[], schema: object, opts: { search?: boolean; prefer?: string[]; kind?: AiKind; signal?: AbortSignal } = {}): Promise<T> {
  return (await generateMeta<T>(settings, parts, schema, opts)).value;
}

async function generateMeta<T>(settings: Settings, parts: Part[], schema: object, opts: { search?: boolean; prefer?: string[]; kind?: AiKind; signal?: AbortSignal; deadline?: number } = {}): Promise<{ value: T; sources: WebSource[] }> {
  /** 이번 질문 전체를 이 시각까지 끝냄 (기본: 모델 두 개를 기다릴 만큼) */
  const deadline = opts.deadline ?? Date.now() + 2 * CALL_MS;
  const apiKey = cleanKey(settings.geminiKey);
  // 내 키가 있으면 지금처럼 폰에서 바로, 없으면 AI 호출 서버로 (서버가 켜져 있을 때만)
  const viaServer = !apiKey && AI_SERVER;
  if (!apiKey && !viaServer) throw new GeminiError("설정에서 Gemini API 키를 먼저 입력해 주세요.");
  // 생각 토큰도 출력 값으로 돈이 나가서 모든 요청의 "생각하기"를 low로 (모델이 거절하면 빼고 다시 보내고, 거절 이유는 사용 기록에 남김)
  // generationConfig.thinkingConfig.thinkingLevel = "LOW" (대문자) 형식으로 보냄 (2026-11-16 사용자가 제미나이에게 받은 형식)
  const thinkingLevel = "LOW";
  const thinking = { thinkingConfig: { thinkingLevel } };
  const makeBody = (fastThinking: boolean) =>
    JSON.stringify(
      opts.search
        ? {
            contents: [{ role: "user", parts: [...parts, { text: `\n답은 다른 말 없이 아래 JSON 스키마에 맞는 JSON 하나만 출력해.\n${JSON.stringify(schema)}` }] }],
            tools: [{ google_search: {} }],
            ...(fastThinking ? { generationConfig: thinking } : {}),
          }
        : {
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: toGeminiSchema(schema),
              temperature: 0.2,
              ...(fastThinking ? thinking : {}),
            },
          },
    );

  // 유료 키 기준: 요청이 몰리거나(429) 서버가 붐비면(5xx) 처음 모델로 잠깐 기다렸다 다시 묻고,
  // 그래도 안 되면 다음 모델로.
  const trace: TraceStep[] = [];
  lastTrace = trace;
  const first = RENAMED[settings.geminiModel] ?? settings.geminiModel;
  const models = modelOrder(settings, opts.prefer);
  let sentThink: string = thinkingLevel;
  let thinkErr = "";
  const call = async (model: string) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const post = async (body: string) => {
      const t0 = performance.now();
      let out: { status: number; text: string };
      if (viaServer) {
        out = await (await import("./aiServer")).callGeminiServer(model, body);
      } else {
        // 한 번에 최대 CALL_MS(남은 시간이 그보다 짧으면 그만큼)만 기다림. 사용자가 취소하면 바로 멈춤
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), Math.max(5_000, Math.min(CALL_MS, deadline - Date.now())));
        const stop = () => ctl.abort();
        opts.signal?.addEventListener("abort", stop);
        try {
          const res = await fetch(url, {
            method: "POST",
            signal: ctl.signal,
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body,
          });
          out = { status: res.status, text: await res.text() };
        } catch (e) {
          if (opts.signal?.aborted || !ctl.signal.aborted) throw e;
          out = { status: TIMEOUT, text: "" };
        } finally {
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", stop);
        }
      }
      trace.push({ model, status: out.status, ms: Math.round(performance.now() - t0), search: !!opts.search, server: viaServer });
      return out;
    };
    opts.signal?.throwIfAborted();
    try {
      const fast = !noFastThinking.has(`${model}|${thinkingLevel}`);
      sentThink = fast ? thinkingLevel : "none";
      const res = await post(makeBody(fast));
      // 생각 설정을 붙인 요청이 400이면 (오류 문구에 thinking이 없어도) 설정을 빼고 한 번 더
      if (fast && res.status === 400 && !/API key|API_KEY/i.test(res.text)) {
        noFastThinking.add(`${model}|${thinkingLevel}`);
        sentThink = "none";
        thinkErr = googleMessage(res.text) || res.text.slice(0, 200);
        return await post(makeBody(false));
      }
      return res;
    } catch (e) {
      if (opts.signal?.aborted) throw opts.signal.reason;
      if (e instanceof Error && e.name === "ServerError") throw new GeminiError(e.message);
      const reason = e instanceof Error ? e.message : String(e);
      throw new GeminiError(`구글 서버에 연결하지 못했어요. 와이파이/데이터를 바꿔 보거나, 광고 차단 앱이 있다면 꺼 보세요. (${reason})`);
    }
  };

  let r = { status: 0, text: "" };
  let busy = false;
  outer: for (const [i, model] of models.entries()) {
    // 정해 둔 시간이 거의 다 됐으면 다른 모델은 그만 (검색 없이 묻기로 넘어가거나 오류로)
    if (i > 0 && deadline - Date.now() < 15_000) break;
    const tries = i === 0 ? 2 : 1;
    for (let attempt = 0; attempt < tries; attempt++) {
      r = await call(model);
      if (r.status === 200) break outer;
      if (r.status === TIMEOUT) {
        busy = true;
        continue outer; // 같은 모델을 또 기다리지 않고 다음 모델로
      }
      if (i > 0 && r.status === 404) continue outer; // 대신 쓰려던 모델이 없음
      if (r.status !== 429 && r.status < 500) break outer; // 키 오류 등은 다른 모델로 바꿔도 같음
      busy = true;
      // 하루 한도 초과는 기다려도 안 풀리니 바로 다음 모델로, 1시간 동안 이 모델은 건너뜀
      if (r.status === 429 && /PerDay/i.test(r.text)) {
        dayLimited.set(model, Date.now() + 60 * 60 * 1000);
        continue outer;
      }
      if (attempt + 1 < tries) await sleep(1500 * (attempt + 1));
      opts.signal?.throwIfAborted();
    }
  }

  if (r.status !== 200) {
    const detail = googleMessage(r.text);
    if (r.status === TIMEOUT) throw new GeminiError("AI 답이 너무 늦어요. 잠시 후 다시 시도해 주세요.");
    if (busy && (r.status === 429 || r.status >= 500 || r.status === 404))
      throw new GeminiError("지금 AI 요청이 몰려 있어요. 잠시 후 다시 시도해 주세요.");
    if (r.status === 401 || (r.status === 400 && /API key|API_KEY/i.test(r.text))) throw new GeminiError("Gemini API 키가 올바르지 않아요. 설정에서 확인해 주세요.");
    if (r.status === 402) throw new GeminiError("AI 결제 잔액이 없어요. AI Studio에서 크레딧을 충전해 주세요.");
    if (r.status === 403) throw new GeminiError("Gemini API 키 권한이 없어요. 설정에서 확인해 주세요.");
    if (r.status === 404) throw new GeminiError(`모델(${settings.geminiModel})을 찾을 수 없어요. 설정에서 모델을 바꿔 주세요.`);
    if (r.status >= 500) throw new GeminiError("구글 Gemini 서버가 지금 붐벼요. 잠시 후 다시 시도해 주세요.");
    throw new GeminiError(`Gemini 오류 (${r.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = JSON.parse(r.text);
  if (opts.kind) recordUsage(opts.kind, trace[trace.length - 1]?.model ?? first, sentThink, data, thinkErr);
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new GeminiError("Gemini가 답을 주지 않았어요. 다시 시도해 주세요.");
  const chunks: { web?: { title?: string; uri?: string } }[] = data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources: WebSource[] = [];
  for (const c of chunks) {
    const title = c.web?.title?.trim();
    if (title && c.web?.uri && !sources.some((x) => x.title === title)) sources.push({ title, uri: c.web.uri });
  }
  try {
    return { value: JSON.parse(extractJson(text)) as T, sources: sources.slice(0, 3) };
  } catch {
    throw new GeminiError("Gemini 응답을 읽지 못했어요. 다시 시도해 주세요.");
  }
}

/** 구글 검색으로 최신 공식 정보를 찾아서 답하게. 검색을 못 쓰거나 형식이 깨지면 검색 없이 */
async function searchJson<T>(settings: Settings, parts: Part[], schema: object, ok: (r: T) => boolean, kind: AiKind, signal?: AbortSignal): Promise<{ value: T; sources: WebSource[] }> {
  // 검색해서 묻기는 최대 1분 반, 안 되면 검색 없이 최대 1분 (전체 2분 반 안에 답이나 오류)
  try {
    const res = await generateMeta<T>(settings, parts, schema, { search: true, kind, signal, deadline: Date.now() + CALL_MS * 1.5 });
    if (!res.value || !ok(res.value)) throw new GeminiError("형식 오류");
    return res;
  } catch (e) {
    if (signal?.aborted) throw e;
    // 검색으로 묻던 시간도 결과 아래 시간 줄에 같이 보이게
    const first = lastTrace;
    try {
      return await generateMeta<T>(settings, parts, schema, { kind, signal, deadline: Date.now() + CALL_MS });
    } finally {
      lastTrace = [...first, ...lastTrace];
    }
  }
}

/** 검색할 때 붙이는 공통 지시 */
const LATEST = "구글 검색으로 최신 공식 정보(제조사·가게 공식 홈페이지, 제품 영양성분표, 식약처 식품영양성분 DB)를 찾아서 그 값을 우선으로 써. 못 찾으면 비슷한 음식으로 추정해. note에는 어떤 기준(몇 개·몇 g·몇 인분)으로 계산했는지만 짧게 쓰고, 출처나 '포장지 기준'·'공식 정보' 같은 말은 쓰지 마(출처는 앱이 검색 기록으로 따로 보여 줘).";

const NUTRIENT_PROPS = {
  kcal: { type: "number", description: "칼로리 (kcal)" },
  carb: { type: "number", description: "탄수화물 (g)" },
  protein: { type: "number", description: "단백질 (g)" },
  fat: { type: "number", description: "지방 (g)" },
  sugar: { type: "number", description: "당류 (g)" },
  fiber: { type: "number", nullable: true, description: "식이섬유 (g), 모르면 null" },
  satFat: { type: "number", nullable: true, description: "포화지방 (g), 모르면 null" },
  transFat: { type: "number", nullable: true, description: "트랜스지방 (g), 모르면 null" },
  unsatFat: { type: "number", nullable: true, description: "불포화지방 (g), 모르면 null" },
  sodium: { type: "number", description: "나트륨 (mg)" },
};
const NUTRIENT_REQ = ["kcal", "carb", "protein", "fat", "sugar", "sodium", "fiber", "satFat", "transFat", "unsatFat"];

/** 세부 영양: 숫자로 온 값만 (null이면 비워 둠) */
const optional = (n: Partial<Nutrients> | undefined) =>
  Object.fromEntries(
    (["fiber", "satFat", "transFat", "unsatFat"] as const)
      .filter((k) => n?.[k] != null && Number.isFinite(Number(n[k])))
      .map((k) => [k, Math.max(0, Number(n![k]))]),
  );

const toNutrients = (n: Partial<Nutrients> | undefined): Nutrients => ({
  kcal: Math.max(0, Number(n?.kcal) || 0),
  carb: Math.max(0, Number(n?.carb) || 0),
  protein: Math.max(0, Number(n?.protein) || 0),
  fat: Math.max(0, Number(n?.fat) || 0),
  sugar: Math.max(0, Number(n?.sugar) || 0),
  ...optional(n),
  sodium: Math.max(0, Number(n?.sodium) || 0),
});

// ---------- 집밥 식재료 ----------
export interface IngredientQuery {
  text: string; // "계란 2개"
  candidates: string[]; // 식약처 DB 후보 이름
}
export interface IngredientAnswer {
  grams: number;
  match: number; // candidates 인덱스, 없으면 -1
  nutrients: Nutrients | null; // match가 -1일 때 그 양 전체의 추정 영양성분
}
export interface IngredientResult { answers: IngredientAnswer[]; sources: WebSource[] }

export async function resolveIngredients(settings: Settings, queries: IngredientQuery[]): Promise<IngredientResult> {
  const prompt = `사용자가 집에서 요리할 때 넣은 식재료 목록이야.
각 식재료마다:
1. grams: 적힌 양을 그램(g)으로 환산해. (예: 계란 1개≈50g, 밥 1공기≈210g, 1큰술≈15g, 양이 없으면 1인분 기준으로 추정)
2. match: 후보(식약처 식품영양성분 DB 이름) 중 가장 알맞은 것의 번호(0부터). 조리 상태(생것/삶은것 등)도 고려해. 알맞은 게 없으면 -1.
3. nutrients: match가 -1일 때만, 그 양 전체(grams 기준)의 영양성분. 구글 검색으로 그 식재료(제품이면 그 제품)의 최신 공식 영양정보를 찾아서 그 값으로 계산해. match가 있으면 0으로 채워.

${queries.map((q, i) => `[${i}] ${q.text}\n후보: ${q.candidates.map((c, j) => `${j}) ${c}`).join(" / ") || "없음"}`).join("\n\n")}`;

  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            grams: { type: "number" },
            match: { type: "integer" },
            nutrients: { type: "object", properties: NUTRIENT_PROPS, required: NUTRIENT_REQ },
          },
          required: ["index", "grams", "match", "nutrients"],
        },
      },
    },
    required: ["items"],
  };
  const { value: res, sources } = await searchJson<{ items: { index: number; grams: number; match: number; nutrients: Nutrients }[] }>(
    settings, [{ text: prompt }], schema, (r) => Array.isArray(r.items), "ingredients",
  );
  const answers = queries.map((q, i) => {
    const a = res.items.find((x) => x.index === i);
    if (!a) return { grams: 0, match: -1, nutrients: null };
    const match = a.match >= 0 && a.match < q.candidates.length ? a.match : -1;
    return { grams: Math.max(0, a.grams || 0), match, nutrients: match === -1 ? toNutrients(a.nutrients) : null };
  });
  return { answers, sources };
}

// ---------- 외식 메뉴 ----------
export interface MenuEstimate {
  name: string;
  grams: number;
  nutrients: Nutrients;
  note: string;
  /** 검색에서 실제로 참고한 페이지. 비어 있으면 검색 근거 없이 AI가 추정한 값 */
  sources?: WebSource[];
}

/**
 * 사용자가 쓴 질문 + 최신 공식 정보를 구글 검색으로 찾으라는 한 줄.
 * 숫자를 칸에 채우려고 답의 형식(JSON 스키마)도 같이 보냄.
 */
export async function askFood(settings: Settings, question: string): Promise<MenuEstimate> {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string", description: "음식 이름" },
      grams: { type: "number", description: "중량(g)" },
      nutrients: { type: "object", properties: NUTRIENT_PROPS, required: NUTRIENT_REQ },
      note: { type: "string", description: "어떤 기준(몇 개·몇 g·몇 인분)으로 계산했는지 한 문장. 출처는 쓰지 마" },
    },
    required: ["name", "grams", "nutrients", "note"],
  };
  const parts = [{ text: `${question}

${LATEST}` }];
  const { value: res, sources } = await searchJson<MenuEstimate>(settings, parts, schema, (r) => !!r.nutrients, "menu");
  return { ...res, grams: Math.max(0, Number(res.grams) || 0), nutrients: toNutrients(res.nutrients), sources };
}

// ---------- 음식 사진 · 영양성분표 사진 ----------
export interface PhotoFood {
  name: string;
  amount: string; // "1공기", "반 그릇"
  grams: number;
  nutrients: Nutrients;
}
export interface PhotoResult {
  type: "label" | "food"; // label: 영양성분표를 읽음 / food: 음식 사진으로 추정
  items: PhotoFood[];
  note: string;
  place?: string; // 설명·사진에서 알아낸 가게 이름
  sources?: WebSource[];
}

/** 사진 분석 질문과 답 형식 (폰에서 바로 물을 때와 서버로 맡길 때 같이 씀) */
/** memo: 사용자가 자유롭게 적은 설명 (가게·메뉴·사이즈·먹은 양). 적었으면 공식 메뉴 정보를 구글 검색으로 참고 */
export function photoQuestion(memo = "") {
  memo = memo.trim();
  const prompt = `이 사진의 영양 정보를 알려줘. ${LATEST}${memo ? `
사용자 설명: ${memo}
- 설명에 가게 이름·메뉴명·사이즈가 있으면 그 가게·메뉴의 최신 공식 정보(메뉴 설명, 구성, 중량, 영양정보)를 찾아서 써.
- 설명에 적힌 먹은 양(반만 먹음, 소스 절반 등)을 그대로 반영해. 사진은 먹기 전일 수 있어.` : ""}
- 영양성분표(포장지의 표)가 보이면 type은 "label". 표의 숫자를 그대로 읽어서 항목 하나로. name은 제품명(보이면, 없으면 "영양성분표"), grams는 표의 기준 중량(1회 제공량 또는 총 내용량), amount는 그 기준("1회 제공량 30g" 등).
- 음식 사진이면 type은 "food". 보이는 음식을 하나씩 나눠서(밥, 국, 반찬 각각) 이름, 보이는 양(amount), 추정 중량(grams), 그 양의 영양성분. 조리에 쓴 기름·소스도 넣어서 추정.
- note: 한국어 한 문장. 추정이면 무엇을 가정했는지.
- place: 설명이나 사진에서 알 수 있는 가게 이름. 모르면 빈 문자열.`;
  const schema = {
    type: "object",
    properties: {
      type: { type: "string", enum: ["label", "food"] },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            amount: { type: "string" },
            grams: { type: "number" },
            nutrients: { type: "object", properties: NUTRIENT_PROPS, required: NUTRIENT_REQ },
          },
          required: ["name", "amount", "grams", "nutrients"],
        },
      },
      note: { type: "string" },
      place: { type: "string" },
    },
    required: ["type", "items", "note", "place"],
  };
  return { prompt, schema };
}

/** AI 답을 앱에서 쓰는 모양으로 */
export function toPhotoResult(res: PhotoResult | undefined, sources: WebSource[]): PhotoResult {
  if (!res?.items?.length) throw new GeminiError("사진에서 음식이나 영양성분표를 찾지 못했어요. 다시 찍어 주세요.");
  return {
    type: res.type === "label" ? "label" : "food",
    note: res.note ?? "",
    place: String(res.place ?? "").trim() || undefined,
    sources,
    items: res.items.map((i) => ({ name: String(i.name || "음식"), amount: String(i.amount ?? ""), grams: Math.max(0, Number(i.grams) || 0), nutrients: toNutrients(i.nutrients) })),
  };
}

/** signal: 기록을 지우면 분석 요청을 끊음 */
export async function analyzeFoodPhoto(settings: Settings, image: { mimeType: string; data: string }, memo = "", signal?: AbortSignal): Promise<PhotoResult> {
  const { prompt, schema } = photoQuestion(memo);
  const parts = [{ inlineData: image }, { text: prompt }];
  const { value: res, sources } = await searchJson<PhotoResult>(settings, parts, schema, (r) => !!r.items?.length, "photo", signal);
  return toPhotoResult(res, sources);
}

// ---------- 인바디 결과지 ----------
export interface InBodyResult {
  date: string | null;
  weight: number | null;
  bodyFat: number | null;
  muscle: number | null;
  bmr: number | null;
}

export async function readInBody(settings: Settings, image: { mimeType: string; data: string }): Promise<InBodyResult> {
  const prompt = `이 이미지는 인바디(체성분 분석) 결과지야. 다음 값을 읽어줘. 읽을 수 없는 값은 null.
- date: 측정 날짜 (YYYY-MM-DD)
- weight: 체중 (kg)
- bodyFat: 체지방률 (%)
- muscle: 골격근량 (kg)
- bmr: 기초대사량 (kcal)`;
  const num = { type: "number", nullable: true };
  const schema = {
    type: "object",
    properties: { date: { type: "string", nullable: true }, weight: num, bodyFat: num, muscle: num, bmr: num },
    required: ["date", "weight", "bodyFat", "muscle", "bmr"],
  };
  // 결과지 숫자 읽기는 간단한 작업이라 항상 3.1 Flash-Lite로 (빠르고 가장 쌈)
  return generateJson<InBodyResult>(settings, [{ inlineData: image }, { text: prompt }], schema, { prefer: ["gemini-3.1-flash-lite"], kind: "inbody" });
}

/** API 키 확인용 */
export async function testGemini(settings: Settings) {
  const res = await generateJson<{ ok: boolean }>(
    settings,
    [{ text: '{"ok": true} 를 그대로 돌려줘' }],
    { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  );
  return res.ok === true;
}

/** 사진을 줄여서 base64로 (인바디 결과지 업로드용) */
export async function imageToBase64(file: File, maxSide = 1600): Promise<{ mimeType: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mimeType: "image/jpeg", data: dataUrl.split(",")[1] };
}

// ---------- 주간 식단 한줄평 ----------
export async function weeklyComment(settings: Settings, goalLabel: string, report: string): Promise<string> {
  const prompt = `너는 한국인 사용자의 식단을 봐 주는 영양 코치야. 사용자의 목표는 "${goalLabel}"이야.
아래는 이번 주(월~일) 하루하루의 섭취량과 목표, 먹은 음식이야.
${report}

2~3문장으로 짧게 평가해 줘.
- 잘한 점 하나, 아쉬운 점 하나를 실제 숫자나 요일·음식을 근거로.
- 다음 주에 바로 해 볼 수 있는 구체적인 팁 하나.
- 존댓말(~해요)로, 꾸밈말 없이 담백하게. 이모지 쓰지 마.`;
  const res = await generateJson<{ comment: string }>(
    settings,
    [{ text: prompt }],
    { type: "object", properties: { comment: { type: "string" } }, required: ["comment"] },
    { kind: "weekly" },
  );
  return (res.comment ?? "").trim();
}
