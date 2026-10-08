// 그룹 초대 링크: https://kangsogo7.github.io/meal-log/?join=코드&g=그룹이름
// 링크로 앱(웹)을 열면 초대를 기억해 두고 그룹 탭에서 바로 참여할 수 있게 함.
// 안드로이드에서 링크를 열면 바로 설치된 앱(meallog://join?code=…)으로 넘김. 앱이 없으면 noapp=1을 붙여 웹으로 돌아옴
import { Capacitor } from "@capacitor/core";

export interface Invite {
  code: string;
  group: string;
  /** 앱으로 넘기려 했는데 앱이 없어 웹으로 돌아온 경우 */
  noApp?: boolean;
}

const KEY = "meal-log-invite";
const EVENT = "meal-invite";
export const WEB_URL = "https://kangsogo7.github.io/meal-log/";
const ANDROID_PACKAGE = "io.github.kangsogo7.meallog";

export const inviteLink = (code: string, group: string) => `${WEB_URL}?join=${code}&g=${encodeURIComponent(group)}`;

/** 안드로이드 크롬 등에서 설치된 앱을 여는 주소 (앱이 없으면 그대로 웹에 머묾) */
export const androidAppLink = (inv: Invite) =>
  `intent://join?code=${inv.code}&g=${encodeURIComponent(inv.group)}#Intent;scheme=meallog;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(inviteLink(inv.code, inv.group) + "&noapp=1")};end`;

export const isNativeApp = () => Capacitor.isNativePlatform();
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
/** 카카오톡 안의 브라우저 (여기서는 다른 앱을 여는 링크가 막히는 경우가 있음) */
export const isKakao = () => /KAKAOTALK/i.test(navigator.userAgent);
/** 카카오톡 안에서 같은 초대를 폰의 기본 브라우저로 다시 열기 */
export const kakaoExternalLink = (inv: Invite) => `kakaotalk://web/openExternal?url=${encodeURIComponent(inviteLink(inv.code, inv.group))}`;
/** 홈 화면에 추가한 앱으로 열었는지 (아니면 사파리·크롬 같은 브라우저) */
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

function parse(url: string): Invite | null {
  try {
    const u = new URL(url);
    const code = (u.searchParams.get("join") ?? u.searchParams.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 6) return null;
    return { code, group: u.searchParams.get("g") ?? "", ...(u.searchParams.has("noapp") ? { noApp: true } : {}) };
  } catch {
    return null;
  }
}

function save(inv: Invite) {
  try {
    localStorage.setItem(KEY, JSON.stringify(inv));
  } catch {
    /* 저장 못 해도 이번 실행 동안은 이벤트로 전달 */
  }
  window.dispatchEvent(new CustomEvent<Invite>(EVENT, { detail: inv }));
}

export function pendingInvite(): Invite | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as Invite) : null;
  } catch {
    return null;
  }
}

export function clearInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}

export function onInvite(cb: (inv: Invite) => void) {
  const h = (e: Event) => cb((e as CustomEvent<Invite>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** 앱을 시작할 때: 주소에 초대가 있으면 기억하고 주소창에서는 지움. 안드로이드 앱은 앱 링크로 받음 */
export function initInvites() {
  const inv = parse(location.href);
  if (inv) {
    save(inv);
    const u = new URL(location.href);
    for (const k of ["join", "g", "noapp"]) u.searchParams.delete(k);
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    // 안드로이드 브라우저(카카오톡 포함)로 열렸으면 바로 앱으로. 앱이 없으면 noapp=1로 이 페이지가 다시 열림
    if (isAndroid() && !isNativeApp() && !inv.noApp) location.href = androidAppLink(inv);
  }
  if (isNativeApp()) {
    import("@capacitor/app")
      .then(async ({ App }) => {
        const launch = await App.getLaunchUrl();
        const first = launch?.url && parse(launch.url);
        if (first) save(first);
        App.addListener("appUrlOpen", (e) => {
          const next = parse(e.url);
          if (next) save(next);
        });
      })
      .catch(() => {});
  }
}
