// AI 호출 서버(Firebase Functions의 gemini)로 요청 보내기.
// 앱이 만든 Gemini 요청 본문을 그대로 넘기고, 서버는 구글의 상태 코드와 응답 본문을 그대로 돌려줌.
// gemini.ts가 필요할 때만 불러옴 (Firebase 코드가 커서 앱 첫 로딩에 넣지 않음)
import { signInAnonymously } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, auth } from "./firebaseApp";

const call = httpsCallable<{ model: string; body: unknown }, { status: number; text: string }>(
  getFunctions(app, "asia-northeast3"),
  "gemini",
  { timeout: 130_000 },
);

/** 서버가 보낸 오류 (하루 한도 등). 화면에 문구를 그대로 보여 줌 */
export class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerError";
  }
}

/** 로그인 안 돼 있으면 익명 계정으로 (그룹 기능과 같은 계정) */
async function ensureSignedIn() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
}

export async function callGeminiServer(model: string, body: string): Promise<{ status: number; text: string }> {
  await ensureSignedIn();
  try {
    return (await call({ model, body: JSON.parse(body) })).data;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    // 서버가 잠깐 안 될 때는 구글 서버가 붐빌 때처럼 다루어 다시 시도·다른 모델로 넘어가게 함
    if (code === "functions/unavailable" || code === "functions/internal" || code === "functions/deadline-exceeded") return { status: 503, text: "" };
    throw new ServerError(e instanceof Error ? e.message : "AI 서버에 연결하지 못했어요.");
  }
}
