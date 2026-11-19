// 사진 분석 서버: 앱이 photoJobs/{uid}/jobs/{jobId}에 사진과 질문을 올리면, 앱이 꺼져 있어도 여기서 분석해서 결과를 그 문서에 적음.
// - 키는 기기마다 따로: 앱이 자기 설정의 Gemini 키를 aiKeys/{uid}에 등록해 두고(앱에서는 읽을 수 없음) 여기서 그 키로 부름
// - 질문(프롬프트)·답 형식·모델 순서는 앱(src/gemini.ts의 photoQuestion)이 정해서 보냄. 여기서는 바꾸지 않음
// - 폰에서 바로 물을 때(src/gemini.ts generateMeta)와 같은 순서로: 구글 검색을 붙여 먼저 묻고, 안 되면 검색 없이.
//   붐비면(429·5xx) 첫 모델로 한 번 더, 그래도 안 되면 다음 모델로
// - 분석이 끝나면(성공·실패 모두) 서버에 올린 사진은 지움
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

initializeApp();
const db = getFirestore();

interface Job {
  status: string;
  image?: { mimeType: string; data: string };
  prompt: string;
  /** 답 형식 (JSON Schema, 글자로) */
  schema: string;
  models: string[];
  thinkingLevel?: string;
}

class AiError extends Error {
  /** 다른 방법(검색 없이)으로 다시 물어도 소용없는 오류 (키 문제 등) */
  constructor(message: string, readonly fatal = false) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** responseSchema는 OpenAPI 형식이라 type을 대문자로 */
function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (s && typeof s === "object")
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toUpperCase() : toGeminiSchema(v)]));
  return s;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  return start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
}

function googleMessage(body: string) {
  try {
    return (JSON.parse(body)?.error?.message as string | undefined)?.slice(0, 200) ?? "";
  } catch {
    return "";
  }
}

interface Answer { value: string; sources: { title: string; uri: string }[]; model: string; think: string; usage: Record<string, number>; searches: number }

/** 한 번 묻기 (모델을 바꿔 가며) */
async function ask(key: string, job: Job, search: boolean): Promise<Answer> {
  const parts = [{ inlineData: job.image }, { text: job.prompt }];
  const level = job.thinkingLevel ?? "LOW";
  const thinking = { thinkingConfig: { thinkingLevel: level } };
  const body = (think: boolean) =>
    JSON.stringify(
      search
        ? {
            contents: [{ role: "user", parts: [...parts, { text: `\n답은 다른 말 없이 아래 JSON 스키마에 맞는 JSON 하나만 출력해.\n${job.schema}` }] }],
            tools: [{ google_search: {} }],
            ...(think ? { generationConfig: thinking } : {}),
          }
        : {
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(JSON.parse(job.schema)), temperature: 0.2, ...(think ? thinking : {}) },
          },
    );
  let think = level;
  const call = async (model: string) => {
    const post = async (b: string) => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: b,
      });
      return { status: res.status, text: await res.text() };
    };
    think = level;
    const r = await post(body(true));
    // 생각 설정을 거절하면 빼고 한 번 더
    if (r.status === 400 && !/API key|API_KEY/i.test(r.text)) {
      think = "none";
      return post(body(false));
    }
    return r;
  };

  let r = { status: 0, text: "" };
  let model = "";
  let busy = false;
  outer: for (const [i, m] of job.models.entries()) {
    model = m;
    const tries = i === 0 ? 2 : 1;
    for (let attempt = 0; attempt < tries; attempt++) {
      r = await call(m);
      if (r.status === 200) break outer;
      if (i > 0 && r.status === 404) continue outer;
      if (r.status !== 429 && r.status < 500) break outer;
      busy = true;
      if (r.status === 429 && /PerDay/i.test(r.text)) continue outer;
      if (attempt + 1 < tries) await sleep(1500 * (attempt + 1));
    }
  }
  if (r.status !== 200) {
    if (busy && (r.status === 429 || r.status >= 500 || r.status === 404)) throw new AiError("지금 AI 요청이 몰려 있어요. 잠시 후 다시 시도해 주세요.");
    if (r.status === 401 || (r.status === 400 && /API key|API_KEY/i.test(r.text))) throw new AiError("Gemini API 키가 올바르지 않아요. 설정에서 확인해 주세요.", true);
    if (r.status === 402) throw new AiError("AI 결제 잔액이 없어요. AI Studio에서 크레딧을 충전해 주세요.", true);
    if (r.status === 403) throw new AiError("Gemini API 키 권한이 없어요. 설정에서 확인해 주세요.", true);
    if (r.status >= 500) throw new AiError("구글 Gemini 서버가 지금 붐벼요. 잠시 후 다시 시도해 주세요.");
    const detail = googleMessage(r.text);
    throw new AiError(`Gemini 오류 (${r.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = JSON.parse(r.text);
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new AiError("Gemini가 답을 주지 않았어요. 다시 시도해 주세요.");
  const value = extractJson(text);
  const parsed = JSON.parse(value); // 깨진 답이면 여기서 오류 → 검색 없이 다시
  if (!parsed?.items?.length) throw new AiError("사진에서 음식이나 영양성분표를 찾지 못했어요. 다시 찍어 주세요.");
  const sources: Answer["sources"] = [];
  for (const c of (data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as { web?: { title?: string; uri?: string } }[]) {
    const title = c.web?.title?.trim();
    if (title && c.web?.uri && !sources.some((x) => x.title === title)) sources.push({ title, uri: c.web.uri });
  }
  return {
    value,
    sources: sources.slice(0, 3),
    model,
    think,
    usage: data?.usageMetadata ?? {},
    searches: data?.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0,
  };
}

/** 검색을 붙여 먼저, 안 되면 검색 없이 (폰의 searchJson과 같게) */
async function analyze(key: string, job: Job): Promise<Answer> {
  try {
    return await ask(key, job, true);
  } catch (e) {
    if (e instanceof AiError && e.fatal) throw e;
    return ask(key, job, false);
  }
}

export const photoJob = onDocumentWritten(
  {
    document: "photoJobs/{uid}/jobs/{jobId}",
    region: "asia-northeast3",
    timeoutSeconds: 300,
    memory: "256MiB",
    // 하는 일이 구글 답을 기다리는 것뿐이라 CPU를 가장 작게
    cpu: "gcf_gen1",
    maxInstances: 10,
    retry: false,
  },
  async (ev) => {
    const after = ev.data?.after;
    if (!after?.exists || after.get("status") !== "queued") return;
    const ref = after.ref;
    // 같은 작업을 두 번 하지 않게 "분석 중"으로 먼저 표시
    const job = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists || s.get("status") !== "queued") return null;
      tx.update(ref, { status: "running", startedAt: FieldValue.serverTimestamp() });
      return s.data() as Job;
    });
    if (!job) return;

    // 앱이 분석 중에 기록을 지우면 문서도 지워짐 → 결과를 적지 않음
    const finish = (data: Record<string, unknown>) =>
      ref.update({ ...data, image: FieldValue.delete(), doneAt: FieldValue.serverTimestamp() }).catch(() => {});
    try {
      const key = (await db.doc(`aiKeys/${ev.params.uid}`).get()).get("key") as string | undefined;
      if (!key) throw new AiError("이 기기의 AI 키가 서버에 없어요. 설정에서 키를 다시 저장해 주세요.", true);
      if (!job.image?.data || !Array.isArray(job.models) || !job.models.length) throw new AiError("요청 형식이 올바르지 않아요.", true);
      const a = await analyze(key, job);
      await finish({ status: "done", ...a });
    } catch (e) {
      await finish({ status: "failed", error: e instanceof AiError ? e.message : "사진을 분석하지 못했어요. 기록을 눌러 다시 해 주세요." });
    }
  },
);
