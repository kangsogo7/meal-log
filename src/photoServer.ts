// 사진 분석을 서버(functions의 photoJob)에 맡기기: 앱을 꺼도 서버에서 분석이 끝나 있고, 다시 열면 결과를 받아 기록을 채움.
// photoJobs/{내 uid}/jobs/{작업 id}에 사진과 질문을 올리고, 서버가 같은 문서에 결과(done) 또는 실패(failed)를 적으면 받아 옴.
// 키는 기기마다 따로: 이 기기 설정의 Gemini 키를 aiKeys/{내 uid}에 등록 (앱에서는 다시 읽을 수 없고 서버만 읽음)
// photoMeal.ts가 필요할 때만 불러옴 (Firebase 코드가 커서 앱 첫 로딩에 넣지 않음)
import { signInAnonymously } from "firebase/auth";
import { deleteDoc, doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc, type DocumentReference } from "firebase/firestore";
import { app, auth } from "./firebaseApp";
import { getKV, setKV, type Settings } from "./db";
import { cleanKey, GeminiError, modelOrder, photoQuestion, recordUsage, toPhotoResult, type PhotoResult } from "./gemini";

const fs = getFirestore(app);

/** 서버에 맡기지 못함 (로그인·연결 문제, 서버가 응답 없음) → 폰에서 바로 분석 */
export class ServerUnavailable extends Error {}

/** 서버가 작업을 받아 가지 않으면 폰에서 바로 하는 시간 */
const PICKUP_MS = 60_000;
/** 서버가 분석을 시작하고 이만큼 지나도 끝나지 않으면(서버 오류로 멈춤) 폰에서 바로 (서버 제한 시간은 5분) */
const STUCK_MS = 6 * 60_000;

async function myUid(): Promise<string> {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!.uid;
}

/** 이 기기의 키를 서버에 등록 (바뀌었을 때만) */
async function syncKey(uid: string, key: string) {
  const mark = `${uid}|${key}`;
  if ((await getKV("serverKeyMark", "")) === mark) return;
  await setDoc(doc(fs, "aiKeys", uid), { key, at: serverTimestamp() });
  await setKV("serverKeyMark", mark);
}

const jobRef = (uid: string, jobId: string) => doc(fs, "photoJobs", uid, "jobs", jobId);

/** 서버가 결과를 적을 때까지 기다림 */
function waitFor(ref: DocumentReference, signal: AbortSignal): Promise<PhotoResult> {
  return new Promise((ok, fail) => {
    let pickup: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      unsub();
      clearTimeout(pickup);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      stop();
      deleteDoc(ref).catch(() => {});
      fail(signal.reason);
    };
    signal.addEventListener("abort", onAbort);
    const unsub = onSnapshot(
      ref,
      (s) => {
        if (!s.exists()) {
          stop();
          return fail(new ServerUnavailable("작업이 없어졌어요"));
        }
        const d = s.data();
        clearTimeout(pickup);
        if (d.status === "queued" && !s.metadata.hasPendingWrites) {
          // 서버가 받아 가지 않음 (함수가 꺼져 있는 등) → 폰에서
          pickup = setTimeout(() => {
            stop();
            deleteDoc(ref).catch(() => {});
            fail(new ServerUnavailable("서버가 작업을 받지 않았어요"));
          }, PICKUP_MS);
        } else if (d.status === "running") {
          const started = d.startedAt?.toMillis?.() ?? Date.now();
          pickup = setTimeout(() => {
            stop();
            deleteDoc(ref).catch(() => {});
            fail(new ServerUnavailable("서버 분석이 멈췄어요"));
          }, Math.max(0, started + STUCK_MS - Date.now()));
        } else if (d.status === "done") {
          stop();
          try {
            recordUsage("photo", d.model, d.think, { usageMetadata: d.usage, candidates: [{ groundingMetadata: { webSearchQueries: Array(d.searches ?? 0).fill("") } }] });
            ok(toPhotoResult(JSON.parse(d.value), d.sources ?? []));
          } catch (e) {
            fail(e instanceof GeminiError ? e : new GeminiError("AI 응답을 읽지 못했어요. 다시 시도해 주세요."));
          }
          deleteDoc(ref).catch(() => {});
        } else if (d.status === "failed") {
          stop();
          deleteDoc(ref).catch(() => {});
          // 서버에 키가 없다고 하면 다음에 다시 등록하게
          if (/키가 서버에 없어요/.test(String(d.error))) setKV("serverKeyMark", "").catch(() => {});
          fail(new GeminiError(String(d.error || "사진을 분석하지 못했어요")));
        }
      },
      () => {
        stop();
        fail(new ServerUnavailable("서버 연결이 끊겼어요"));
      },
    );
  });
}

/**
 * 서버에서 사진 분석. 같은 jobId로 이미 맡긴 작업이 있으면(앱을 껐다 켬) 다시 올리지 않고 결과만 받아 옴.
 * makeImage: 새로 맡길 때만 사진을 준비
 */
export async function analyzeOnServer(
  settings: Settings,
  jobId: string,
  makeImage: () => Promise<{ mimeType: string; data: string }>,
  signal: AbortSignal,
): Promise<PhotoResult> {
  let ref: DocumentReference;
  try {
    const uid = await myUid();
    ref = jobRef(uid, jobId);
    const old = await getDoc(ref);
    // 이미 맡긴 작업이면(앱을 껐다 켬) 결과만 받아 옴. 결과를 받으면 문서를 지우므로, 실패한 기록을 다시 누르면 새로 맡김
    if (!old.exists()) {
      await syncKey(uid, cleanKey(settings.geminiKey));
      const { prompt, schema } = photoQuestion();
      await setDoc(ref, {
        status: "queued",
        image: await makeImage(),
        prompt,
        schema: JSON.stringify(schema),
        models: modelOrder(settings),
        thinkingLevel: "LOW",
        at: serverTimestamp(),
      });
    }
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    throw new ServerUnavailable(e instanceof Error ? e.message : String(e));
  }
  signal.throwIfAborted();
  return waitFor(ref, signal);
}
