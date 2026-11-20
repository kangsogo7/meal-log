// 사진 분석을 서버(functions의 photoJob)에 맡기기: 앱을 꺼도 서버에서 분석이 끝나 있고, 다시 열면 결과를 받아 기록을 채움.
// photoJobs/{내 uid}/jobs/{작업 id}에 사진과 질문을 올리고, 서버가 같은 문서에 결과(done) 또는 실패(failed)를 적으면 받아 옴.
// 키는 기기마다 따로: 이 기기 설정의 Gemini 키를 aiKeys/{내 uid}에 등록 (앱에서는 다시 읽을 수 없고 서버만 읽음)
// photoMeal.ts가 필요할 때만 불러옴 (Firebase 코드가 커서 앱 첫 로딩에 넣지 않음)
import { signInAnonymously } from "firebase/auth";
import { deleteDoc, doc, getDoc, getDocFromServer, getFirestore, onSnapshot, serverTimestamp, setDoc, type DocumentData, type DocumentReference } from "firebase/firestore";
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 서버가 결과를 적을 때까지 기다림.
 * - 실시간 알림(onSnapshot)으로 받고, 앱이 앞으로 돌아올 때마다 서버에 직접 한 번 더 물어봄
 *   (아이폰에서 앱이 오래 뒤로 가 있다 돌아오면 실시간 연결이 다시 붙는 데 오래 걸려서, 결과를 늦게 받던 문제)
 * - 인터넷이 안 되거나 확인이 안 될 때는 절대 포기하지 않고 계속 기다림. 서버가 직접 "아직 안 받아 감 / 멈춤"이라고 확인해 줄 때만 폰에서 분석
 *   (앱을 켜자마자 인터넷이 붙기 전에 확인하다 실패해서, 서버가 끝내 둔 결과를 지우고 다시 분석하던 문제, 2026-11-20)
 */
function waitFor(ref: DocumentReference, signal: AbortSignal): Promise<PhotoResult> {
  return new Promise((ok, fail) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let ended = false;
    let checking = false;
    const stop = () => {
      ended = true;
      unsub();
      clearTimeout(timer);
      clearTimeout(poll);
      signal.removeEventListener("abort", onAbort);
      document.removeEventListener("visibilitychange", onVisible);
    };
    const onAbort = () => {
      stop();
      deleteDoc(ref).catch(() => {});
      fail(signal.reason);
    };
    signal.addEventListener("abort", onAbort);

    /** 결과(done·failed)를 받아 기록에 넘김. 결과가 아니면 false */
    const settle = (d: DocumentData | undefined): boolean => {
      if (d?.status === "done") {
        stop();
        try {
          recordUsage("photo", d.model, d.think, { usageMetadata: d.usage, candidates: [{ groundingMetadata: { webSearchQueries: Array(d.searches ?? 0).fill("") } }] });
          ok(toPhotoResult(JSON.parse(d.value), d.sources ?? []));
        } catch (e) {
          fail(e instanceof GeminiError ? e : new GeminiError("AI 응답을 읽지 못했어요. 다시 시도해 주세요."));
        }
        deleteDoc(ref).catch(() => {});
        return true;
      }
      if (d?.status === "failed") {
        stop();
        deleteDoc(ref).catch(() => {});
        // 서버에 키가 없다고 하면 다음에 다시 등록하게
        if (/키가 서버에 없어요/.test(String(d.error))) setKV("serverKeyMark", "").catch(() => {});
        fail(new GeminiError(String(d.error || "사진을 분석하지 못했어요")));
        return true;
      }
      return false;
    };

    /** 서버에 직접 물어봄. 확인이 안 되면(인터넷 등) 15초 뒤 다시 */
    const check = async () => {
      if (ended || checking) return;
      checking = true;
      clearTimeout(poll);
      try {
        const fresh = await getDocFromServer(ref);
        if (ended) return;
        if (!fresh.exists()) {
          // 서버에도 없음 (다른 곳에서 지움) → 폰에서
          stop();
          return fail(new ServerUnavailable("작업이 없어졌어요"));
        }
        const d = fresh.data();
        if (settle(d)) return;
        const at = d.at?.toMillis?.() ?? Date.now();
        const started = d.startedAt?.toMillis?.() ?? Date.now();
        // 서버가 직접 확인해 준 경우만 포기: 1분이 넘도록 안 받아 감 / 시작하고 6분이 넘도록 안 끝남 (서버 제한 5분)
        if ((d.status === "queued" && Date.now() - at > PICKUP_MS) || (d.status === "running" && Date.now() - started > STUCK_MS)) {
          stop();
          deleteDoc(ref).catch(() => {});
          return fail(new ServerUnavailable(d.status === "queued" ? "서버가 작업을 받지 않았어요" : "서버 분석이 멈췄어요"));
        }
        watch(d);
      } catch {
        if (!ended) poll = setTimeout(() => void check(), 15_000);
      } finally {
        checking = false;
      }
    };

    /** 아직 결과가 아니면: 받아 가지 않거나 멈춘 걸 알아차릴 때 서버에 확인 */
    const watch = (d: DocumentData, pendingWrite = false) => {
      clearTimeout(timer);
      if (d.status === "queued" && !pendingWrite) timer = setTimeout(() => void check(), PICKUP_MS);
      else if (d.status === "running") {
        const started = d.startedAt?.toMillis?.() ?? Date.now();
        timer = setTimeout(() => void check(), Math.max(0, started + STUCK_MS - Date.now()));
      }
    };

    // 앱이 앞으로 돌아오면 바로 서버에 물어봄 (실시간 연결이 다시 붙길 기다리지 않음)
    const onVisible = () => {
      if (!document.hidden) setTimeout(() => void check(), 500);
    };
    document.addEventListener("visibilitychange", onVisible);

    const unsub = onSnapshot(
      ref,
      (s) => {
        if (ended) return;
        // 휴대폰에 남아 있던 예전 정보는 믿지 않고 서버에 확인 (결과면 그대로 씀)
        if (s.metadata.fromCache) {
          if (s.exists() && settle(s.data())) return;
          return void check();
        }
        if (!s.exists()) {
          stop();
          return fail(new ServerUnavailable("작업이 없어졌어요"));
        }
        const d = s.data();
        if (settle(d)) return;
        watch(d, s.metadata.hasPendingWrites);
      },
      // 실시간 연결이 끊기면 15초마다 직접 물어봄
      () => void check(),
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
    // 앱을 켜자마자는 인터넷이 아직 안 붙었을 수 있어서 몇 번 다시 (확인 못 하고 새로 올리면 같은 사진을 두 번 분석함)
    let old: Awaited<ReturnType<typeof getDoc>> | null = null;
    let why = "";
    for (let i = 0; i < 4 && !old; i++) {
      old = await getDoc(ref).catch((e) => ((why = e instanceof Error ? e.message : String(e)), null));
      if (!old && i < 3) await sleep(2000 * (i + 1));
    }
    if (!old) throw new Error(`서버에 연결하지 못했어요 (${why})`);
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
