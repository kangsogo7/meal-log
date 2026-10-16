// Google Gemini API (REST generateContent) 호출
import type { Nutrients, Settings } from "./db";

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

/** 마지막 요청이 어느 모델에 몇 번, 얼마나 걸렸는지 (느릴 때 원인 확인용) */
export interface TraceStep { model: string; status: number; ms: number; search: boolean }
let lastTrace: TraceStep[] = [];
export const getLastTrace = () => lastTrace;
/** "4.2초 · gemini-3.8-flash" / 재시도가 있었으면 단계별로 */
export function formatTrace(t: TraceStep[]) {
  if (!t.length) return "";
  const total = t.reduce((a, s) => a + s.ms, 0);
  const steps = t.map((s) => `${s.model.replace("gemini-", "")}${s.search ? "(검색)" : ""} ${s.status === 200 ? "" : s.status + " "}${(s.ms / 1000).toFixed(1)}초`).join(" → ");
  return `${(total / 1000).toFixed(1)}초 · ${steps}`;
}

/** 생각하기 최소 설정을 거절한 모델 (다음부터는 바로 빼고 보냄) */
const noFastThinking = new Set<string>();

// 3.7 Flash → 3.8, 3.5 Flash → 3.6으로 통합됨 (2026-10 구글 안내). 같은 모델로 다시 물어봐야 한도만 쓰므로 목록에서 뺌
/** 없어진 모델 → 넘어간 모델 */
const RENAMED: Record<string, string> = { "gemini-3.7-flash": "gemini-3.8-flash", "gemini-3.5-flash": "gemini-3.6-flash" };

export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

const LITE_MODELS = GEMINI_MODELS.filter((m) => m.endsWith("-lite"));

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
async function generateJson<T>(settings: Settings, parts: Part[], schema: object, opts: { search?: boolean; prefer?: string[] } = {}): Promise<T> {
  const apiKey = cleanKey(settings.geminiKey);
  if (!apiKey) throw new GeminiError("설정에서 Gemini API 키를 먼저 입력해 주세요.");
  // 검색 없는 요청은 "생각하기"를 최소로 해서 빨리 답하게 (모델이 이 설정을 모르면 빼고 다시 보냄)
  const makeBody = (fastThinking: boolean) =>
    JSON.stringify(
      opts.search
        ? {
            contents: [{ role: "user", parts: [...parts, { text: `\n답은 다른 말 없이 아래 JSON 스키마에 맞는 JSON 하나만 출력해.\n${JSON.stringify(schema)}` }] }],
            tools: [{ google_search: {} }],
          }
        : {
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: toGeminiSchema(schema),
              temperature: 0.2,
              ...(fastThinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
            },
          },
    );

  // 무료 한도는 모델마다 따로라서, 한도 초과(429)면 바로 다음 모델로.
  // 서버가 붐비면(5xx) 처음 모델은 한 번 더 기다렸다가, 그래도 안 되면 다음 모델로.
  const trace: TraceStep[] = [];
  lastTrace = trace;
  const first = RENAMED[settings.geminiModel] ?? settings.geminiModel;
  // prefer: 간단한 작업은 설정한 모델 대신 가벼운 모델부터 (한도가 차면 나머지 모델로)
  const order = [...(opts.prefer ?? []), first, ...GEMINI_MODELS];
  const models = order.filter((m, i) => order.indexOf(m) === i);
  const call = async (model: string) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const post = async (body: string) => {
      const t0 = performance.now();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      const out = { status: res.status, text: await res.text() };
      trace.push({ model, status: res.status, ms: Math.round(performance.now() - t0), search: !!opts.search });
      return out;
    };
    try {
      const fast = !opts.search && !noFastThinking.has(model);
      const res = await post(makeBody(fast));
      if (fast && res.status === 400 && /thinking/i.test(res.text)) {
        noFastThinking.add(model);
        return await post(makeBody(false));
      }
      return res;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new GeminiError(`구글 서버에 연결하지 못했어요. 와이파이/데이터를 바꿔 보거나, 광고 차단 앱이 있다면 꺼 보세요. (${reason})`);
    }
  };

  let r = { status: 0, text: "" };
  let quotaHit = false;
  outer: for (const [i, model] of models.entries()) {
    const tries = i === 0 ? 2 : 1;
    for (let attempt = 0; attempt < tries; attempt++) {
      r = await call(model);
      if (r.status === 200) break outer;
      if (r.status === 429) {
        quotaHit = true;
        continue outer;
      }
      if (i > 0 && r.status === 404) continue outer; // 대신 쓰려던 모델이 없음
      if (r.status < 500) break outer; // 키 오류 등은 다른 모델로 바꿔도 같음
      await sleep(1500 * (attempt + 1));
    }
  }

  if (r.status !== 200) {
    const detail = googleMessage(r.text);
    if (quotaHit && (r.status === 429 || r.status >= 500 || r.status === 404))
      throw new GeminiError("오늘 Gemini 무료 사용 한도를 모든 모델에서 다 썼어요. 직접 입력하거나 내일 다시 시도해 주세요.");
    if (r.status === 401 || (r.status === 400 && /API key|API_KEY/i.test(r.text))) throw new GeminiError("Gemini API 키가 올바르지 않아요. 설정에서 확인해 주세요.");
    if (r.status === 403) throw new GeminiError("Gemini API 키 권한이 없어요. 설정에서 확인해 주세요.");
    if (r.status === 404) throw new GeminiError(`모델(${settings.geminiModel})을 찾을 수 없어요. 설정에서 모델을 바꿔 주세요.`);
    if (r.status >= 500) throw new GeminiError("구글 Gemini 서버가 지금 붐벼요. 잠시 후 다시 시도해 주세요.");
    throw new GeminiError(`Gemini 오류 (${r.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = JSON.parse(r.text);
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new GeminiError("Gemini가 답을 주지 않았어요. 다시 시도해 주세요.");
  try {
    return JSON.parse(extractJson(text)) as T;
  } catch {
    throw new GeminiError("Gemini 응답을 읽지 못했어요. 다시 시도해 주세요.");
  }
}

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

export async function resolveIngredients(settings: Settings, queries: IngredientQuery[]): Promise<IngredientAnswer[]> {
  const prompt = `너는 한국 영양사야. 사용자가 집에서 요리할 때 넣은 식재료 목록이야.
각 식재료마다:
1. grams: 적힌 양을 그램(g)으로 환산해. (예: 계란 1개≈50g, 밥 1공기≈210g, 1큰술≈15g, 양이 없으면 1인분 기준으로 추정)
2. match: 후보(식약처 식품영양성분 DB 이름) 중 가장 알맞은 것의 번호(0부터). 조리 상태(생것/삶은것 등)도 고려해. 알맞은 게 없으면 -1.
3. nutrients: match가 -1일 때만, 그 양 전체(grams 기준)의 영양성분 추정치. match가 있으면 0으로 채워.

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
  const res = await generateJson<{ items: { index: number; grams: number; match: number; nutrients: Nutrients }[] }>(
    settings, [{ text: prompt }], schema,
  );
  return queries.map((q, i) => {
    const a = res.items.find((x) => x.index === i);
    if (!a) return { grams: 0, match: -1, nutrients: null };
    const match = a.match >= 0 && a.match < q.candidates.length ? a.match : -1;
    return { grams: Math.max(0, a.grams || 0), match, nutrients: match === -1 ? toNutrients(a.nutrients) : null };
  });
}

// ---------- 외식 메뉴 ----------
export interface MenuEstimate {
  name: string;
  grams: number;
  nutrients: Nutrients;
  note: string;
}

/**
 * 사용자가 쓴 질문을 그대로 보냄 (앱이 덧붙이는 지시 없음).
 * 숫자를 칸에 채우려고 답의 형식(JSON 스키마)만 정해 줌. 검색 모드는 형식을 강제할 수 없어서 형식 안내 한 줄이 붙음.
 */
export async function askFood(settings: Settings, question: string, search = false): Promise<MenuEstimate> {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string", description: "음식 이름" },
      grams: { type: "number", description: "중량(g)" },
      nutrients: { type: "object", properties: NUTRIENT_PROPS, required: NUTRIENT_REQ },
      note: { type: "string", description: "답변" },
    },
    required: ["name", "grams", "nutrients", "note"],
  };
  const parts = [{ text: question }];
  let res: MenuEstimate;
  if (search) {
    try {
      res = await generateJson<MenuEstimate>(settings, parts, schema, { search: true });
      if (!res?.nutrients) throw new GeminiError("형식 오류");
    } catch {
      // 검색을 못 쓰는 경우(한도 등)엔 검색 없이
      res = await generateJson<MenuEstimate>(settings, parts, schema);
    }
  } else {
    res = await generateJson<MenuEstimate>(settings, parts, schema);
  }
  return { ...res, grams: Math.max(0, Number(res.grams) || 0), nutrients: toNutrients(res.nutrients) };
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
}

export async function analyzeFoodPhoto(settings: Settings, image: { mimeType: string; data: string }, memo = ""): Promise<PhotoResult> {
  const prompt = `이 사진의 영양 정보를 알려줘.
- 영양성분표(포장지의 표)가 보이면 type은 "label". 표의 숫자를 그대로 읽어서 항목 하나로. name은 제품명(보이면, 없으면 "영양성분표"), grams는 표의 기준 중량(1회 제공량 또는 총 내용량), amount는 그 기준("1회 제공량 30g" 등).
- 음식 사진이면 type은 "food". 보이는 음식을 하나씩 나눠서(밥, 국, 반찬 각각) 이름, 보이는 양(amount), 추정 중량(grams), 그 양의 영양성분. 조리에 쓴 기름·소스도 넣어서 추정.
- note: 한국어 한 문장. 추정이면 무엇을 가정했는지.${memo ? `\n- 사용자 메모: ${memo}` : ""}`;
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
    },
    required: ["type", "items", "note"],
  };
  const res = await generateJson<PhotoResult>(settings, [{ inlineData: image }, { text: prompt }], schema);
  if (!res?.items?.length) throw new GeminiError("사진에서 음식이나 영양성분표를 찾지 못했어요. 다시 찍어 주세요.");
  return {
    type: res.type === "label" ? "label" : "food",
    note: res.note ?? "",
    items: res.items.map((i) => ({ name: String(i.name || "음식"), amount: String(i.amount ?? ""), grams: Math.max(0, Number(i.grams) || 0), nutrients: toNutrients(i.nutrients) })),
  };
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
  // 결과지 숫자 읽기는 간단한 작업이라 Lite 모델로 (빠르고 한도도 넉넉함)
  return generateJson<InBodyResult>(settings, [{ inlineData: image }, { text: prompt }], schema, { prefer: LITE_MODELS });
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
  );
  return (res.comment ?? "").trim();
}
