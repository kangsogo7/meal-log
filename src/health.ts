// 건강 데이터 가져오기
// - 안드로이드·아이폰 앱: Health Connect / HealthKit 직접 읽기
// - 아이폰 웹앱(PWA): 단축어가 만든 글을 붙여넣기
import { Capacitor } from "@capacitor/core";
import { addDays, db, todayStr, toDateStr, type DayActivity, type Workout } from "./db";

export type HealthMode = "android-app" | "ios-app" | "ios-web" | "android-web" | "web";

export function healthMode(): HealthMode {
  const p = Capacitor.getPlatform();
  if (Capacitor.isNativePlatform()) return p === "ios" ? "ios-app" : "android-app";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios-web";
  if (/Android/.test(ua)) return "android-web";
  return "web";
}

export class HealthError extends Error {}

// 흔한 운동 종류 한국어 이름 (나머지는 원래 이름)
const WORKOUT_KO: Record<string, string> = {
  strengthTraining: "근력운동", traditionalStrengthTraining: "근력운동", functionalStrengthTraining: "기능성 근력운동",
  weightlifting: "웨이트", coreTraining: "코어 운동", highIntensityIntervalTraining: "인터벌(HIIT)",
  running: "달리기", runningTreadmill: "러닝머신", walking: "걷기", hiking: "등산", cycling: "자전거",
  bikingStationary: "실내 자전거", swimming: "수영", swimmingPool: "수영", elliptical: "일립티컬",
  rowing: "로잉", rowingMachine: "로잉머신", stairClimbing: "계단 오르기", stairClimbingMachine: "천국의 계단",
  yoga: "요가", pilates: "필라테스", stretching: "스트레칭", flexibility: "스트레칭", mixedCardio: "유산소",
  crossTraining: "크로스 트레이닝", jumpRope: "줄넘기", boxing: "복싱", dance: "댄스", badminton: "배드민턴",
  tennis: "테니스", soccer: "축구", basketball: "농구", golf: "골프", other: "기타 운동",
};
// "Traditional Strength Training"(단축어) / "traditionalStrengthTraining"(앱) 둘 다 찾도록
const WORKOUT_KO_NORM = new Map(Object.entries(WORKOUT_KO).map(([k, v]) => [k.toLowerCase(), v]));
export const workoutLabel = (t: string) => WORKOUT_KO_NORM.get(t.replace(/[\s_-]/g, "").toLowerCase()) ?? t;

/** 하루 전체 이전 기록과 합치기: 새로 읽은 값이 있는 항목만 덮어씀 */
async function mergeDays(days: Map<string, Partial<DayActivity>>, source: DayActivity["source"]) {
  const rows: DayActivity[] = [];
  for (const [date, d] of days) {
    const prev = await db.activity.get(date);
    rows.push({
      date,
      steps: d.steps ?? prev?.steps,
      activeKcal: d.activeKcal ?? prev?.activeKcal,
      workouts: d.workouts ?? prev?.workouts ?? [],
      source,
      syncedAt: Date.now(),
    });
  }
  await db.activity.bulkPut(rows);
  return rows.length;
}

/** 체중·체지방: 그 날짜에 직접 입력·인바디 기록이 없을 때만 건강 앱 값을 넣음 */
async function mergeBody(list: { date: string; weight?: number; bodyFat?: number }[]) {
  let added = 0;
  for (const b of list) {
    if (!b.weight) continue;
    const same = await db.body.where("date").equals(b.date).toArray();
    if (same.some((r) => r.source !== "health")) continue;
    const prev = same.find((r) => r.source === "health");
    const rec = { date: b.date, weight: Math.round(b.weight * 10) / 10, bodyFat: b.bodyFat ? Math.round(b.bodyFat * 10) / 10 : prev?.bodyFat, source: "health" as const };
    if (prev) await db.body.update(prev.id!, rec);
    else {
      await db.body.add(rec);
      added++;
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// 앱: Health Connect / HealthKit
// ---------------------------------------------------------------------------
export async function syncFromHealth(days = 14): Promise<{ days: number; workouts: number; body: number }> {
  const { Health } = await import("@capgo/capacitor-health");
  const avail = await Health.isAvailable();
  if (!avail.available) {
    throw new HealthError(
      Capacitor.getPlatform() === "android"
        ? "Health Connect를 쓸 수 없어요. Play 스토어에서 'Health Connect'를 설치하거나 업데이트해 주세요."
        : `건강 앱을 쓸 수 없어요. (${avail.reason ?? "알 수 없는 이유"})`,
    );
  }
  await Health.requestAuthorization({ read: ["steps", "calories", "workouts", "weight", "bodyFat"] });

  const from = new Date(`${addDays(todayStr(), -(days - 1))}T00:00:00`);
  const range = { startDate: from.toISOString(), endDate: new Date().toISOString() };
  const map = new Map<string, Partial<DayActivity>>();
  const day = (iso: string) => {
    const d = toDateStr(new Date(iso));
    if (!map.has(d)) map.set(d, {});
    return map.get(d)!;
  };

  // 권한을 일부만 허용했을 수 있어서 항목별로 따로 읽음
  const tryRead = async <T>(f: () => Promise<T>) => {
    try {
      return await f();
    } catch {
      return null;
    }
  };

  const steps = await tryRead(() => Health.queryAggregated({ ...range, dataType: "steps", bucket: "day", aggregation: "sum" }));
  steps?.samples.forEach((s) => (day(s.startDate).steps = Math.round(s.value)));

  const kcal = await tryRead(() => Health.queryAggregated({ ...range, dataType: "calories", bucket: "day", aggregation: "sum" }));
  kcal?.samples.forEach((s) => (day(s.startDate).activeKcal = Math.round(s.value)));

  const wo = await tryRead(() => Health.queryWorkouts({ ...range, limit: 200, ascending: true }));
  let workoutCount = 0;
  if (wo) {
    // 운동이 없던 날도 "운동 없음"으로 갱신되도록 기간 안의 모든 날에 빈 목록을 먼저 둠
    for (let i = 0; i < days; i++) {
      const d = addDays(todayStr(), -i);
      if (!map.has(d)) map.set(d, {});
      map.get(d)!.workouts = [];
    }
    for (const w of wo.workouts) {
      const list = day(w.startDate).workouts!;
      list.push({
        type: workoutLabel(w.workoutType),
        start: w.startDate,
        minutes: Math.round(w.duration / 60),
        kcal: w.totalEnergyBurned ? Math.round(w.totalEnergyBurned) : undefined,
      });
      workoutCount++;
    }
  }

  // 체중·체지방은 최근 90일
  const bodyRange = { startDate: new Date(Date.now() - 90 * 864e5).toISOString(), endDate: range.endDate, limit: 500, ascending: true };
  const weights = await tryRead(() => Health.readSamples({ ...bodyRange, dataType: "weight" }));
  const fats = await tryRead(() => Health.readSamples({ ...bodyRange, dataType: "bodyFat" }));
  const body = new Map<string, { date: string; weight?: number; bodyFat?: number }>();
  weights?.samples.forEach((s) => {
    const d = toDateStr(new Date(s.startDate));
    body.set(d, { ...body.get(d), date: d, weight: s.value }); // 같은 날은 마지막 값
  });
  fats?.samples.forEach((s) => {
    const d = toDateStr(new Date(s.startDate));
    // 플랫폼에 따라 0~1 비율로 오기도 함
    const pct = s.value <= 1 ? s.value * 100 : s.value;
    body.set(d, { ...body.get(d), date: d, bodyFat: pct });
  });

  if (!steps && !kcal && !wo && !weights) {
    throw new HealthError("건강 데이터 권한이 없어요. 설정에서 권한을 허용해 주세요.");
  }

  const n = await mergeDays(map, Capacitor.getPlatform() === "ios" ? "healthkit" : "healthconnect");
  const b = await mergeBody([...body.values()]);
  return { days: n, workouts: workoutCount, body: b };
}

export async function openHealthSettings() {
  const { Health } = await import("@capgo/capacitor-health");
  await Health.openHealthConnectSettings();
}

// ---------------------------------------------------------------------------
// 아이폰 웹앱: 단축어가 만든 글 붙여넣기
// ---------------------------------------------------------------------------
/*
  단축어가 만드는 글 (한 날짜씩, 여러 날짜를 이어 붙여도 됨):
    날짜: 2026-10-06
    걸음: 8123
    활동칼로리: 512
    체중: 74.8
    체지방: 22.1
    운동: 근력운동, 55분, 320kcal
*/
const num = (s: string) => {
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

/** "55분", "1:05:00", "3300초", "55 min" → 분 */
function minutesOf(s: string): number | undefined {
  const hms = s.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (hms) return hms[3] ? Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60 : Number(hms[1]) + Number(hms[2]) / 60;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(시간|hr|hour|h\b)/i);
  const m = s.match(/(\d+(?:\.\d+)?)\s*(분|min|m\b)/i);
  const sec = s.match(/(\d+(?:\.\d+)?)\s*(초|sec|s\b)/i);
  if (h || m || sec) return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) + (sec ? Number(sec[1]) / 60 : 0);
  const n = num(s);
  if (n === undefined) return undefined;
  return n > 600 ? n / 60 : n; // 단위가 없으면 큰 수는 초로 봄
}

function parseWorkout(v: string): Workout | null {
  const parts = v.split(/[,，/]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const type = workoutLabel(parts.find((p) => !/^\d/.test(p)) ?? "운동");
  const rest = parts.filter((p) => p !== type);
  const kcalPart = rest.find((p) => /kcal|칼로리|cal/i.test(p));
  const durPart = rest.find((p) => p !== kcalPart);
  const minutes = durPart ? minutesOf(durPart) : undefined;
  const kcal = kcalPart ? num(kcalPart) : rest.length >= 2 ? num(rest[1]) : undefined;
  return { type, minutes: Math.round(minutes ?? 0), kcal: kcal !== undefined ? Math.round(kcal) : undefined };
}

export function parseShortcutText(text: string) {
  const days = new Map<string, Partial<DayActivity>>();
  const body: { date: string; weight?: number; bodyFat?: number }[] = [];
  let date = todayStr();
  const cur = () => {
    if (!days.has(date)) days.set(date, {});
    return days.get(date)!;
  };
  let known = 0;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*([^:：]+)[:：]\s*(.*)$/);
    if (!m) continue;
    const key = m[1].replace(/\s/g, "").toLowerCase();
    const v = m[2].trim();
    if (/^(날짜|date)$/.test(key)) {
      const d = v.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
      if (d) date = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
      known++;
    } else if (/^(걸음|걸음수|steps?)$/.test(key)) {
      cur().steps = Math.round(num(v) ?? 0);
      known++;
    } else if (/^(활동칼로리|활동에너지|activekcal|activeenergy|active)$/.test(key)) {
      cur().activeKcal = Math.round(num(v) ?? 0);
      known++;
    } else if (/^(체중|몸무게|weight)$/.test(key)) {
      const w = num(v);
      if (w) body.push({ date, weight: w });
      known++;
    } else if (/^(체지방|체지방률|bodyfat)$/.test(key)) {
      const f = num(v);
      const last = body.find((b) => b.date === date);
      if (f !== undefined) {
        const pct = f <= 1 ? f * 100 : f;
        if (last) last.bodyFat = pct;
        else body.push({ date, bodyFat: pct });
      }
      known++;
    } else if (/^(운동|workout)$/.test(key)) {
      const w = parseWorkout(v);
      if (w) (cur().workouts ??= []).push(w);
      known++;
    }
  }
  return { days, body, known };
}

export async function importShortcutText(text: string) {
  const { days, body, known } = parseShortcutText(text);
  if (!known) throw new HealthError("단축어 데이터가 아니에요. 단축어를 실행한 뒤 다시 붙여넣어 주세요.");
  const n = await mergeDays(days, "shortcut");
  const b = await mergeBody(body);
  return { days: n, body: b };
}
