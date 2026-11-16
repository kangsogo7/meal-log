// AI 호출 서버: 앱이 보낸 Gemini 요청 본문(REST JSON)을 그대로 구글에 전달하고, 응답을 그대로 돌려줌.
// 유료 키는 이 서버(Secret Manager)에만 있고 앱에는 들어가지 않음.
// 프롬프트·스키마·생각 수준 같은 요청 내용은 앱(src/gemini.ts)이 정하고, 서버는 바꾸지 않음.
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/** 서버로 부를 수 있는 모델 (앱의 GEMINI_MODELS와 같게) */
const MODELS = new Set(["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-4-hydrogen"]);

/** 한 사람이 하루에 부를 수 있는 횟수 (키를 빼 가도 마구 쓰지 못하게 하는 안전장치. 무료·구독 횟수는 나중에 따로) */
const DAILY_LIMIT = 100;

/** 한국 날짜 (YYYY-MM-DD) */
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** 오늘 횟수를 1 올림. 한도를 넘으면 거절 */
async function countCall(uid: string) {
  const ref = getFirestore().doc(`aiCalls/${uid}`);
  const day = kstDay();
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = snap.get("day") === day ? (snap.get("n") as number) : 0;
    if (n >= DAILY_LIMIT) throw new HttpsError("resource-exhausted", `오늘 AI를 ${DAILY_LIMIT}번 써서 더 쓸 수 없어요. 내일 다시 시도해 주세요.`);
    tx.set(ref, { day, n: n + 1, at: FieldValue.serverTimestamp() });
  });
}

export const gemini = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 120,
    memory: "256MiB",
    // 하는 일이 구글 답을 기다리는 것뿐이라 CPU를 가장 작게 (기다리는 시간에도 요금이 나가서). 이 설정에서는 인스턴스 하나가 요청 하나만 받음
    cpu: "gcf_gen1",
    concurrency: 1,
    maxInstances: 20,
  },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요해요.");
    const { model, body } = (req.data ?? {}) as { model?: unknown; body?: unknown };
    if (typeof model !== "string" || !MODELS.has(model)) throw new HttpsError("invalid-argument", "쓸 수 없는 모델이에요.");
    if (!body || typeof body !== "object" || !Array.isArray((body as { contents?: unknown }).contents))
      throw new HttpsError("invalid-argument", "요청 형식이 올바르지 않아요.");

    await countCall(req.auth.uid);

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY.value() },
      body: JSON.stringify(body),
    });
    // 상태 코드와 본문을 그대로 돌려줘서, 앱의 재시도·다른 모델로 넘어가기 로직이 지금과 똑같이 동작하게 함
    return { status: res.status, text: await res.text() };
  },
);
