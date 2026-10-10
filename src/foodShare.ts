// 음식 공유: 내가 기록한 음식(1회 제공량 + 양 조절 배수)을 링크로 보내거나 그룹에서 가져와 바로 기록.
// 링크: https://kangsogo7.github.io/meal-log/?food=<음식 정보>  (안드로이드 앱은 meallog://food?food=…)
import type { EntryKind, Item } from "./db";
import { isAndroid, isNativeApp, WEB_URL } from "./invite";

export interface SharedFood {
  kind: EntryKind;
  title: string;
  place?: string;
  /** 먹은 양 기준 재료 (k로 나누면 1회 제공량) */
  items: Item[];
  k?: number;
  /** 그룹에서 가져온 경우 올린 사람 이름 (링크에는 넣지 않음) */
  from?: string;
}

const KEY = "meal-log-food";
const EVENT = "meal-food";
const ANDROID_PACKAGE = "io.github.kangsogo7.meallog";
const r1 = (v: number) => Math.round((Number(v) || 0) * 10) / 10;

/** 링크에 담기 좋게 줄인 음식 정보 */
export function slimFood(f: SharedFood): SharedFood {
  return {
    kind: f.kind,
    title: f.title,
    ...(f.place ? { place: f.place } : {}),
    ...(f.k && f.k !== 1 ? { k: r1(f.k) } : {}),
    items: f.items.slice(0, 20).map((i) => ({
      name: i.name,
      amountText: i.amountText ?? "",
      grams: i.grams ? r1(i.grams) : null,
      source: i.source ?? "manual",
      nutrients: {
        kcal: Math.round(i.nutrients.kcal), carb: r1(i.nutrients.carb), protein: r1(i.nutrients.protein),
        fat: r1(i.nutrients.fat), sugar: r1(i.nutrients.sugar ?? 0), sodium: Math.round(i.nutrients.sodium ?? 0),
      },
    })),
  };
}

const toB64 = (s: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const foodLink = (f: SharedFood) => `${WEB_URL}?food=${toB64(JSON.stringify(slimFood(f)))}`;

/** 안드로이드 크롬·카카오톡에서 설치된 앱으로 열기 (앱이 없으면 웹으로) */
const androidFoodLink = (data: string) =>
  `intent://food?food=${data}#Intent;scheme=meallog;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(`${WEB_URL}?food=${data}&noapp=1`)};end`;

function parse(url: string): { food: SharedFood; data: string; noApp: boolean } | null {
  try {
    const u = new URL(url);
    const data = u.searchParams.get("food");
    if (!data) return null;
    const food = JSON.parse(fromB64(data)) as SharedFood;
    if (!food?.title || !Array.isArray(food.items) || !food.items.length) return null;
    return { food, data, noApp: u.searchParams.has("noapp") };
  } catch {
    return null;
  }
}

function save(food: SharedFood) {
  try {
    localStorage.setItem(KEY, JSON.stringify(food));
  } catch {
    /* 이번 실행 동안은 이벤트로 전달 */
  }
  window.dispatchEvent(new CustomEvent<SharedFood>(EVENT, { detail: food }));
}

export function pendingFood(): SharedFood | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as SharedFood) : null;
  } catch {
    return null;
  }
}

export function clearFood() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}

/** 그룹 화면 등에서 바로 "나도 기록" 창 띄우기 */
export const openSharedFood = (food: SharedFood) => window.dispatchEvent(new CustomEvent<SharedFood>(EVENT, { detail: food }));

export function onFood(cb: (f: SharedFood) => void) {
  const h = (e: Event) => cb((e as CustomEvent<SharedFood>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** 앱 시작 시: 주소에 공유 음식이 있으면 기억하고 주소창에서 지움. 안드로이드 브라우저면 설치된 앱으로 */
export function initFoodShare() {
  const got = parse(location.href);
  if (got) {
    save(got.food);
    const u = new URL(location.href);
    for (const k of ["food", "noapp"]) u.searchParams.delete(k);
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    if (isAndroid() && !isNativeApp() && !got.noApp) location.href = androidFoodLink(got.data);
  }
  if (isNativeApp()) {
    import("@capacitor/app")
      .then(async ({ App }) => {
        const launch = await App.getLaunchUrl();
        const first = launch?.url && parse(launch.url);
        if (first) save(first.food);
        App.addListener("appUrlOpen", (e) => {
          const next = parse(e.url);
          if (next) save(next.food);
        });
      })
      .catch(() => {});
  }
}

/** 공유 창(카톡 등)으로 보내기. 공유 창이 없으면 링크 복사 */
export async function shareFood(f: SharedFood): Promise<"shared" | "copied" | "cancel"> {
  const url = foodLink(f);
  const text = `식단 기록 · ${f.place ? f.place + " " : ""}${f.title}${f.k && f.k !== 1 ? ` (×${r1(f.k)})` : ""}\n링크를 누르면 바로 기록할 수 있어요.`;
  try {
    if (navigator.share) {
      await navigator.share({ title: f.title, text, url });
      return "shared";
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return "copied";
  } catch {
    return "cancel";
  }
}
