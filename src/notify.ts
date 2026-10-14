// 물·영양제 알림 (안드로이드·아이폰 앱만. 홈 화면 웹앱은 정해진 시간에 알림을 띄울 수 없음)
// 매일 반복 대신 앞으로 7일치를 한 번씩 예약해 두고, 기록이 바뀔 때마다 다시 예약:
// 오늘 이미 다 먹은 영양제·다 마신 물은 그날 알림을 빼고, 물 알림에는 지금까지 마신 양을 넣기 위해
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { addDays, todayStr } from "./db";
import { getDayCheck, getHydration, getReminders, getSupplements, suppSlots } from "./checks";

export const canNotify = () => Capacitor.isNativePlatform();

/** 이 앱이 쓰는 알림 번호 (날짜·종류로 정해져 있어서 다시 예약할 때 같은 번호를 지움) */
const BASE = 100000;
const DAYS = 7;
const isOurs = (id: number) => id >= BASE && id < BASE + DAYS * 100;

/** 알림 권한 요청. 허용되면 true */
export async function askNotifyPermission() {
  if (!canNotify()) return false;
  const p = await LocalNotifications.requestPermissions();
  return p.display === "granted";
}

const at = (date: string, hhmm: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h || 0, min || 0);
};

let running: Promise<void> | null = null;
let again = false;

/** 알림을 지금 설정·기록에 맞게 다시 예약 (여러 번 불려도 한 번씩 차례로) */
export function rescheduleReminders() {
  if (!canNotify()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await schedule();
      } while (again);
    } catch (e) {
      console.warn("알림 예약 실패", e);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function schedule() {
  const pending = await LocalNotifications.getPending();
  const old = pending.notifications.filter((n) => isOurs(n.id));
  if (old.length) await LocalNotifications.cancel({ notifications: old.map((n) => ({ id: n.id })) });

  const [rem, supps, hyd] = await Promise.all([getReminders(), getSupplements(), getHydration()]);
  if (!rem.supp && !rem.water) return;
  if ((await LocalNotifications.checkPermissions()).display !== "granted") return;

  const now = Date.now();
  const today = todayStr();
  const list: { id: number; title: string; body: string; schedule: { at: Date; allowWhileIdle: boolean } }[] = [];
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(today, i);
    const check = i === 0 ? await getDayCheck(today) : null;
    if (rem.supp) {
      // 아침·점심·저녁·자기 전 + 직접 정한 시각들 (하루 10묶음까지, 물 알림 번호는 10부터)
      suppSlots(supps, rem.times).slice(0, 10).forEach((w, slot) => {
        const due = w.list.filter((s) => !check?.supps[s.id]);
        const when = at(date, w.time);
        if (!due.length || +when <= now) return;
        list.push({
          id: BASE + i * 100 + slot,
          title: `${w.label} 영양제 먹을 시간이에요`,
          body: due.map((s) => `${s.name} ${s.count}정`).join(", "),
          schedule: { at: when, allowWhileIdle: true },
        });
      });
    }
    if (rem.water && !(check && check.waterMl >= hyd.goalMl)) {
      const end = +at(date, rem.waterTo);
      const step = Math.max(1, rem.waterEvery) * 3600000;
      for (let t = +at(date, rem.waterFrom), k = 0; t <= end && k < 80; t += step, k++) {
        if (t <= now) continue;
        list.push({
          id: BASE + i * 100 + 10 + k,
          title: "물 마실 시간이에요",
          body: check ? `오늘 ${check.waterMl.toLocaleString()} / ${hyd.goalMl.toLocaleString()}ml 마셨어요` : `오늘 목표 ${hyd.goalMl.toLocaleString()}ml`,
          schedule: { at: new Date(t), allowWhileIdle: true },
        });
      }
    }
  }
  if (list.length) await LocalNotifications.schedule({ notifications: list });
}

let checksRequested = false;
/** 알림을 눌러 들어왔으면 true (한 번 가져가면 지움) */
export function takeChecksRequest() {
  const r = checksRequested;
  checksRequested = false;
  return r;
}

/** 앱을 다시 열 때(날짜가 바뀌었을 수 있음) 다시 예약, 알림을 누르면 물·영양제 창 열기 */
export function initReminders() {
  if (!canNotify()) return;
  rescheduleReminders();
  App.addListener("resume", () => rescheduleReminders());
  LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
    if (!isOurs(a.notification.id)) return;
    checksRequested = true;
    window.dispatchEvent(new Event("open-checks"));
  });
}
