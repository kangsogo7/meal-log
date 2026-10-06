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

export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

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

async function generateJson<T>(settings: Settings, parts: Part[], schema: object): Promise<T> {
  const apiKey = cleanKey(settings.geminiKey);
  if (!apiKey) throw new GeminiError("설정에서 Gemini API 키를 먼저 입력해 주세요.");
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(schema), temperature: 0.2 },
  });

  // 무료 한도는 모델마다 따로라서, 한도 초과(429)면 바로 다음 모델로.
  // 서버가 붐비면(5xx) 처음 모델은 한 번 더 기다렸다가, 그래도 안 되면 다음 모델로.
  const models = [settings.geminiModel, ...GEMINI_MODELS.filter((m) => m !== settings.geminiModel)];
  const call = async (model: string) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      return { status: res.status, text: await res.text() };
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
    return JSON.parse(text) as T;
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
  sodium: { type: "number", description: "나트륨 (mg)" },
};
const NUTRIENT_REQ = ["kcal", "carb", "protein", "fat", "sugar", "sodium"];

const toNutrients = (n: Partial<Nutrients> | undefined): Nutrients => ({
  kcal: Math.max(0, Number(n?.kcal) || 0),
  carb: Math.max(0, Number(n?.carb) || 0),
  protein: Math.max(0, Number(n?.protein) || 0),
  fat: Math.max(0, Number(n?.fat) || 0),
  sugar: Math.max(0, Number(n?.sugar) || 0),
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

export async function estimateMenu(
  settings: Settings,
  place: string,
  menu: string,
  amount: string,
  references: string[],
  kind: "out" | "food" = "out",
): Promise<MenuEstimate> {
  const refs = references.length ? `참고 (식약처 DB, 100g 기준):\n${references.join("\n")}\n` : "";
  const prompt =
    kind === "out"
      ? `너는 한국 외식 메뉴 영양 정보를 잘 아는 영양사야.
가게: ${place || "(모름)"}
메뉴: ${menu}
먹은 양: ${amount || "1인분"}
${refs}
이 가게의 이 메뉴를 "먹은 양"만큼 먹었을 때의 영양성분을 추정해.
프랜차이즈라면 공식 영양 정보를 최대한 기억해서 쓰고, 모르면 비슷한 메뉴의 일반적인 값으로 추정해.
note에는 근거나 가정(예: "공식 영양정보 기준", "일반적인 1인분 400g 가정")을 한국어로 짧게 적어.`
      : `너는 한국에서 파는 식품(편의점·마트 제품, 과일, 유제품 등)의 영양 정보를 잘 아는 영양사야.
식품: ${[place, menu].filter(Boolean).join(" ")}
먹은 양: ${amount || "1개 (1회 제공량)"}
${refs}
이 식품을 "먹은 양"만큼 먹었을 때의 영양성분을 추정해.
시판 제품이라면 포장지 영양정보를 최대한 기억해서 쓰고, 모르면 비슷한 제품의 일반적인 값으로 추정해.
note에는 근거나 가정(예: "제품 영양정보 기준 1봉지 120g", "중간 크기 1개 기준")을 한국어로 짧게 적어.`;

  const schema = {
    type: "object",
    properties: {
      name: { type: "string", description: "메뉴 이름" },
      grams: { type: "number", description: "먹은 양의 추정 중량(g)" },
      nutrients: { type: "object", properties: NUTRIENT_PROPS, required: NUTRIENT_REQ },
      note: { type: "string" },
    },
    required: ["name", "grams", "nutrients", "note"],
  };
  const res = await generateJson<MenuEstimate>(settings, [{ text: prompt }], schema);
  return { ...res, nutrients: toNutrients(res.nutrients) };
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
  return generateJson<InBodyResult>(settings, [{ inlineData: image }, { text: prompt }], schema);
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
