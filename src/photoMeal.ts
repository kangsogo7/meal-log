// 사진으로 바로 기록: 찍거나 고르면 끼니에 먼저 기록해 두고, 뒤에서 AI가 사진을 보고 음식·칼로리·영양성분을 채움.
// 앱을 닫았다 열어도 분석 중이던 기록은 다시 이어서 분석
import { db, DEFAULT_SETTINGS, getKV, photoKey, sumNutrients, todayStr, addDays, ZERO, type Item, type Meal } from "./db";
import { aiReady, analyzeFoodPhoto, GeminiError, imageToBase64 } from "./gemini";
import { runInBackground } from "./bgJobs";

export const photoJobKey = (id: number) => `photoEntry:${id}`;

/** 분석 중인 기록의 요청 (기록을 지우면 끊음) */
const running = new Map<number, AbortController>();

/** 기록을 지울 때: 분석 중이면 AI 요청을 멈춤 */
export function cancelPhotoEntry(id: number) {
  running.get(id)?.abort(new DOMException("기록을 지웠어요", "AbortError"));
  running.delete(id);
}

/** 사진을 끼니 사진으로 두고 "분석 중" 기록을 바로 만든 뒤 분석 시작. 만든 기록의 id */
export async function recordPhotoMeal(date: string, meal: Meal, blob: Blob): Promise<number> {
  // 기록마다 사진 따로 (한 끼에 여러 장이어도 덮어쓰지 않음)
  const at = Date.now();
  const key = `${photoKey(date, meal)}|${at}`;
  await db.photos.put({ key, date, meal, blob, at });
  const id = (await db.entries.add({
    date, meal, kind: "home", title: "사진 분석 중", items: [], total: { ...ZERO },
    createdAt: at, pending: "ai", photo: key,
  })) as number;
  analyzePhotoEntry(id);
  return id;
}

/** 사진 기록 분석 (실패한 기록을 다시 분석할 때도) */
export function analyzePhotoEntry(id: number) {
  runInBackground(
    photoJobKey(id),
    async () => {
      const e = await db.entries.get(id);
      if (!e) return;
      const ctrl = new AbortController();
      running.set(id, ctrl);
      await db.entries.update(id, { pending: "ai" });
      try {
        const settings = await getKV("settings", DEFAULT_SETTINGS);
        if (!aiReady(settings)) throw new GeminiError("AI 키가 없어서 사진을 분석하지 못했어요. 설정에서 키를 넣어 주세요.");
        const photo = e.photo ? await db.photos.get(e.photo) : undefined;
        if (!photo) throw new GeminiError("사진을 찾지 못했어요");
        const image = await imageToBase64(new File([photo.blob], "meal.jpg", { type: photo.blob.type || "image/jpeg" }), 1024);
        const r = await analyzeFoodPhoto(settings, image, "", ctrl.signal);
        if (!r.items.length) throw new GeminiError("사진에서 음식을 찾지 못했어요");
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
        if (!(await db.entries.get(id))) return; // 분석 중에 지운 기록
        await db.entries.update(id, {
          title, place: r.place || undefined, kind: r.place ? "out" : "home",
          items, total: sumNutrients(items.map((i) => i.nutrients)), pending: undefined,
        });
      } catch (err) {
        if (ctrl.signal.aborted) throw ctrl.signal.reason; // 지운 기록: 알림 없이 끝
        if (await db.entries.get(id)) await db.entries.update(id, { pending: "failed" });
        throw err;
      } finally {
        if (running.get(id) === ctrl) running.delete(id);
      }
    },
    { done: "사진 분석이 끝났어요", fail: (e) => (e instanceof GeminiError ? e.message : "사진을 분석하지 못했어요. 기록을 눌러 다시 해 주세요.") },
  );
}

/** 앱을 열 때: 분석 중이던 사진 기록(최근 3일)을 다시 분석 */
export async function resumePhotoMeals() {
  const list = await db.entries.where("date").aboveOrEqual(addDays(todayStr(), -3)).toArray();
  for (const e of list) if (e.pending === "ai" && e.id) analyzePhotoEntry(e.id);
}
