// 사진 분석 서버(functions의 photoJob)와 주고받기. 결과를 두는 곳은 서버의 작업 문서 하나뿐:
//   photoJobs/{내 uid}/jobs/{기록 id}-{만든 시각}
//   앱이 사진과 질문을 올림(queued) → 서버가 분석해서 같은 문서에 결과(done) 또는 실패(failed)를 적음
//   → 앱을 켜거나 앱으로 돌아올 때 "끝난 것"을 한 번에 읽어 와 기록을 채우고, 채운 뒤에만 문서를 지움 (photoMeal.ts)
// 키는 기기마다 따로: 이 기기 설정의 Gemini 키를 aiKeys/{내 uid}에 등록 (앱에서는 다시 읽을 수 없고 서버만 읽음)
// photoMeal.ts가 필요할 때만 불러옴 (Firebase 코드가 커서 앱 첫 로딩에 넣지 않음)
import { signInAnonymously } from "firebase/auth";
import { collection, deleteDoc, doc, getDocsFromServer, getFirestore, onSnapshot, serverTimestamp, setDoc, type DocumentData } from "firebase/firestore";
import { app, auth } from "./firebaseApp";
import { getKV, setKV, type Settings } from "./db";
import { cleanKey, GeminiError, modelOrder, photoQuestion, recordUsage, toPhotoResult, type PhotoResult } from "./gemini";

const fs = getFirestore(app);

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

const jobs = (uid: string) => collection(fs, "photoJobs", uid, "jobs");

/** 서버에 분석 맡기기 (같은 id의 예전 작업이 있으면 덮어씀) */
export async function submitJob(settings: Settings, jobId: string, image: { mimeType: string; data: string }) {
  const uid = await myUid();
  await syncKey(uid, cleanKey(settings.geminiKey));
  const { prompt, schema } = photoQuestion();
  await setDoc(doc(jobs(uid), jobId), {
    status: "queued",
    image,
    prompt,
    schema: JSON.stringify(schema),
    models: modelOrder(settings),
    thinkingLevel: "LOW",
    at: serverTimestamp(),
  });
}

export interface JobDoc { id: string; status: string; data: DocumentData }

const toJob = (id: string, data: DocumentData): JobDoc => ({ id, status: String(data.status ?? ""), data });

/** 내 작업 문서 전부 (서버에서 바로 읽음. 휴대폰에 남은 예전 정보는 쓰지 않음) */
export async function listJobs(): Promise<JobDoc[]> {
  const uid = await myUid();
  const snap = await getDocsFromServer(jobs(uid));
  return snap.docs.map((d) => toJob(d.id, d.data()));
}

/** 앱을 보고 있는 동안: 작업 문서가 바뀌면 바로 알려 줌. 끊으려면 돌려준 함수를 부름 */
export async function watchJobs(onChange: (list: JobDoc[]) => void): Promise<() => void> {
  const uid = await myUid();
  return onSnapshot(jobs(uid), (snap) => {
    // 휴대폰에 남은 예전 정보로는 판단하지 않음 (서버에서 온 것만)
    if (snap.metadata.fromCache) return;
    onChange(snap.docs.map((d) => toJob(d.id, d.data())));
  }, () => {});
}

export async function deleteJob(jobId: string) {
  const uid = await myUid();
  await deleteDoc(doc(jobs(uid), jobId));
}

/** 서버가 적은 결과 → 앱에서 쓰는 모양. 실패면 GeminiError */
export function jobResult(j: JobDoc): PhotoResult {
  const d = j.data;
  if (j.status === "failed") {
    // 서버에 키가 없다고 하면 다음에 다시 등록하게
    if (/키가 서버에 없어요/.test(String(d.error))) setKV("serverKeyMark", "").catch(() => {});
    throw new GeminiError(String(d.error || "사진을 분석하지 못했어요"));
  }
  let value: PhotoResult;
  try {
    value = JSON.parse(d.value);
  } catch {
    throw new GeminiError("AI 응답을 읽지 못했어요. 기록을 눌러 다시 해 주세요.");
  }
  recordUsage("photo", d.model, d.think, { usageMetadata: d.usage, candidates: [{ groundingMetadata: { webSearchQueries: Array(d.searches ?? 0).fill("") } }] });
  return toPhotoResult(value, d.sources ?? []);
}
