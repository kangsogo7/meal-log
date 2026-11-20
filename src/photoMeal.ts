// 사진으로 바로 기록: 찍거나 고르면 끼니에 "분석 중" 기록을 먼저 만들고, 사진은 서버에 맡겨 AI가 분석함.
// 결과는 서버의 작업 문서(photoServer.ts)에만 있고, 앱은 그걸 읽어 와 기록을 채움:
//   - 앱을 켤 때(식단 화면)·앱으로 돌아올 때: 서버에서 "끝난 작업"을 한 번에 읽어 와 채움
//   - 앱을 보고 있는 동안: 작업이 끝나면 바로 알림 받아 채움
//   - 기록을 채운 뒤에만 서버 문서를 지움. 앱이 서버 결과를 지우거나 스스로 다시 요청하지 않음
//     (예외: 사진을 올리기 전에 앱이 꺼져서 서버에 작업이 아예 없는 "분석 중" 기록만 다시 올림)
//   - 실패는 서버가 "실패"라고 적었을 때(또는 올리지 못했을 때)만. 실패한 기록을 누르면 다시 맡김
import { db, DEFAULT_SETTINGS, getKV, photoKey, sumNutrients, todayStr, addDays, ZERO, type Entry, type Item, type Meal } from "./db";
import { aiReady, GeminiError, imageToBase64, type PhotoResult } from "./gemini";
import { flash } from "./components/ui";

/** 서버 작업 문서 이름: 기록 id + 만든 시각 (기록을 지웠다 다시 만들어도 겹치지 않게) */
const jobIdOf = (e: Entry) => `${e.id}-${e.createdAt}`;
const server = () => import("./photoServer");

/** 지금 올리는 중인 기록 (겹쳐 올리지 않게) */
const submitting = new Set<number>();

/** 사진을 끼니 사진으로 두고 "분석 중" 기록을 바로 만든 뒤 서버에 맡김. 만든 기록의 id */
export async function recordPhotoMeal(date: string, meal: Meal, blob: Blob): Promise<number> {
  // 기록마다 사진 따로 (한 끼에 여러 장이어도 덮어쓰지 않음)
  const at = Date.now();
  const key = `${photoKey(date, meal)}|${at}`;
  await db.photos.put({ key, date, meal, blob, at });
  const id = (await db.entries.add({
    date, meal, kind: "home", title: "사진 분석 중", items: [], total: { ...ZERO },
    createdAt: at, pending: "ai", photo: key,
  })) as number;
  void submitPhotoEntry(id);
  return id;
}

/** 서버에 분석 맡기기 (새 사진 · 실패한 기록 다시 · 지운 기록 되돌리기) */
export async function submitPhotoEntry(id: number) {
  if (submitting.has(id)) return;
  submitting.add(id);
  try {
    const e = await db.entries.get(id);
    if (!e || !e.pending) return;
    await db.entries.update(id, { pending: "ai" });
    const settings = await getKV("settings", DEFAULT_SETTINGS);
    if (!aiReady(settings)) throw new GeminiError("AI 키가 없어서 사진을 분석하지 못했어요. 설정에서 키를 넣어 주세요.");
    const photo = e.photo ? await db.photos.get(e.photo) : undefined;
    if (!photo) throw new GeminiError("사진을 찾지 못했어요");
    const image = await imageToBase64(new File([photo.blob], "meal.jpg", { type: photo.blob.type || "image/jpeg" }), 1024);
    const s = await server();
    await s.submitJob(settings, jobIdOf(e), image);
    void watch();
  } catch (err) {
    if (await db.entries.get(id)) await db.entries.update(id, { pending: "failed" });
    flash(err instanceof GeminiError ? err.message : "사진을 서버에 올리지 못했어요. 인터넷을 확인하고 기록을 눌러 다시 해 주세요.");
  } finally {
    submitting.delete(id);
  }
}

/** 기록을 지울 때: 서버 작업도 지움 (분석 중이면 결과를 적지 않음) */
export function cancelPhotoEntry(e: Entry) {
  if (!e.pending || e.id == null) return;
  server().then((s) => s.deleteJob(jobIdOf(e))).catch(() => {});
}

/** AI 결과로 기록 채우기 */
async function fill(id: number, r: PhotoResult) {
  const items: Item[] = r.items.map((f) => ({
    name: f.name,
    amountText: f.amount || (f.grams ? `${Math.round(f.grams)}g` : ""),
    grams: f.grams || null,
    source: "ai",
    via: r.type === "label" ? "label" : "photo",
    nutrients: f.nutrients,
  }));
  const names = items.map((i) => i.name);
  const title = names.slice(0, 2).join(", ") + (names.length > 2 ? ` 외 ${names.length - 2}개` : "");
  await db.entries.update(id, {
    title, place: r.place || undefined, kind: r.place ? "out" : "home",
    items, total: sumNutrients(items.map((i) => i.nutrients)), pending: undefined,
  });
}

// 결과 채우기는 한 번에 하나씩 (앱을 켤 때 읽은 것과 실시간 알림이 겹쳐도 두 번 채우지 않게)
let queue: Promise<void> = Promise.resolve();
const serial = (f: () => Promise<void>) => (queue = queue.then(f, f));

type JobDoc = import("./photoServer").JobDoc;

/** 서버에서 끝난 작업(완료·실패)을 기록에 반영하고, 반영한 작업 문서는 지움 */
function applyJobs(list: JobDoc[]) {
  return serial(async () => {
    const s = await server();
    for (const j of list) {
      if (j.status !== "done" && j.status !== "failed") continue;
      const id = Number(j.id.split("-")[0]);
      const e = Number.isFinite(id) ? await db.entries.get(id) : undefined;
      // 그 기록이 아직 결과를 기다리면 채움 (지운 기록·이미 채운 기록이면 문서만 지움)
      if (e && e.pending && jobIdOf(e) === j.id) {
        try {
          await fill(id, s.jobResult(j));
          flash("사진 분석이 끝났어요");
        } catch (err) {
          await db.entries.update(id, { pending: "failed" });
          flash(err instanceof GeminiError ? err.message : "사진을 분석하지 못했어요. 기록을 눌러 다시 해 주세요.");
        }
      }
      await s.deleteJob(j.id).catch(() => {});
    }
  });
}

/** 앱을 보고 있는 동안 실시간으로 받기 (한 번만 붙임) */
let watching: Promise<unknown> | null = null;
function watch() {
  watching ??= server()
    .then((s) => s.watchJobs((list) => void applyJobs(list)))
    .catch(() => (watching = null));
  return watching;
}

/** 결과를 기다리는 기록 (최근 3일) */
const waitingEntries = async () =>
  (await db.entries.where("date").aboveOrEqual(addDays(todayStr(), -3)).toArray()).filter((e) => e.pending === "ai");

/**
 * 앱을 켤 때·앱으로 돌아올 때: 서버에서 끝난 작업을 한 번에 읽어 와 채움.
 * 서버에 작업이 아예 없는 "분석 중" 기록(사진을 올리기 전에 앱이 꺼짐)만 다시 올림
 */
export async function syncPhotoJobs() {
  const waiting = await waitingEntries();
  if (!waiting.length) return;
  void watch();
  let list: JobDoc[];
  try {
    list = await (await server()).listJobs();
  } catch {
    return; // 인터넷이 안 되면 다음에 앱으로 돌아올 때
  }
  await applyJobs(list);
  const onServer = new Set(list.map((j) => j.id));
  for (const e of await waitingEntries()) {
    if (!onServer.has(jobIdOf(e)) && !submitting.has(e.id!) && Date.now() - e.createdAt > 30_000) void submitPhotoEntry(e.id!);
  }
}

// 앱으로 돌아올 때마다 확인
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void syncPhotoJobs();
});
