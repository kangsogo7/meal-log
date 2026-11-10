// 안드로이드 홈 화면 위젯 연결 (물 · 영양제 · 식단 기록)
// - 앱 → 위젯: 오늘 물·영양제·칼로리를 네이티브 저장소에 넣고 위젯을 다시 그림 (pushWidgets)
// - 위젯 → 앱: 위젯에서 누른 "+1잔"·영양제 체크는 네이티브에 쌓여 있다가, 앱이 열릴 때 기록에 반영 (applyPending)
// - 식단 위젯: 끼니를 누르면 meallog://add?meal=… 로 앱이 열리고 그 끼니 기록 화면으로
import { Capacitor, registerPlugin } from "@capacitor/core";
import { db, MEALS, sumNutrients, todayStr, type Meal } from "./db";
import { addWater, getDayCheck, getHydration, getSupplements, sortSupps, toggleSupp } from "./checks";

interface Pending { type: "water"; date: string; ml: number }
interface PendingSupp { type: "supp"; date: string; id: string; on: boolean }
interface WidgetBridgePlugin {
  update(o: { state: string }): Promise<void>;
  takePending(): Promise<{ actions: string }>;
}
const Bridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge");
const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

/** 오늘 상태를 위젯에 보냄 */
export async function pushWidgets() {
  if (!isAndroidApp()) return;
  const date = todayStr();
  const [day, hyd, supps, entries] = await Promise.all([getDayCheck(date), getHydration(), getSupplements(), db.entries.where("date").equals(date).toArray()]);
  const kcal = Math.round(sumNutrients(entries.map((e) => e.total)).kcal);
  const state = {
    date,
    water: { ml: day.waterMl, goalMl: hyd.goalMl, cupMl: hyd.cupMl },
    supps: sortSupps(supps).slice(0, 4).map((s) => ({ id: s.id, name: s.name, on: !!day.supps[s.id] })),
    kcal,
    meals: MEALS.map((m) => ({ key: m.key, label: m.label, kcal: Math.round(sumNutrients(entries.filter((e) => e.meal === m.key).map((e) => e.total)).kcal) })),
  };
  await Bridge.update({ state: JSON.stringify(state) }).catch(() => {});
}

/** 위젯에서 누른 것들을 기록에 반영 */
export async function applyPending() {
  if (!isAndroidApp()) return;
  let list: (Pending | PendingSupp)[] = [];
  try {
    list = JSON.parse((await Bridge.takePending()).actions || "[]");
  } catch {
    return;
  }
  for (const a of list) {
    if (a.type === "water") await addWater(a.date, a.ml);
    else if (a.type === "supp") {
      const d = await getDayCheck(a.date);
      // 이미 앱에서 같은 상태로 바꿔 뒀으면 그대로
      if (!!d.supps[a.id] !== a.on) await toggleSupp(a.date, a.id);
    }
  }
  if (list.length) await pushWidgets();
}

let addRequest: Meal | null = null;
/** 식단 위젯에서 끼니를 눌러 들어왔으면 그 끼니 (한 번 가져가면 지움) */
export function takeAddRequest() {
  const r = addRequest;
  addRequest = null;
  return r;
}

function parseAdd(url?: string): Meal | null {
  if (!url?.startsWith("meallog://add")) return null;
  const m = new URL(url).searchParams.get("meal");
  return MEALS.some((x) => x.key === m) ? (m as Meal) : null;
}

/** 앱 시작 때 한 번: 위젯 반영, 앱으로 돌아올 때마다 다시, 끼니 링크 처리 */
export function initWidgets() {
  if (!isAndroidApp()) return;
  applyPending().then(pushWidgets);
  import("@capacitor/app")
    .then(async ({ App }) => {
      App.addListener("resume", () => applyPending().then(pushWidgets));
      const take = (url?: string) => {
        const meal = parseAdd(url);
        if (!meal) return;
        addRequest = meal;
        window.dispatchEvent(new Event("open-add"));
      };
      take((await App.getLaunchUrl())?.url);
      App.addListener("appUrlOpen", (e) => take(e.url));
    })
    .catch(() => {});
}
