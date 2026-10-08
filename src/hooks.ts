import { useLiveQuery } from "dexie-react-hooks";
import { db, DEFAULT_SETTINGS, getKV, todayStr, type BodyRecord, type DayActivity, type Nutrients, type Profile, type Settings } from "./db";
import { calcTargets, DEFAULT_PROFILE, type TargetResult } from "./nutrition";

export function useSettings(): Settings {
  return useLiveQuery(() => getKV("settings", DEFAULT_SETTINGS), [], DEFAULT_SETTINGS);
}

export function useProfile(): Profile | undefined {
  return useLiveQuery(() => getKV("profile", DEFAULT_PROFILE), []);
}

/** 사용자가 내 정보를 한 번이라도 저장했는지 */
export function useProfileSaved(): boolean | undefined {
  return useLiveQuery(async () => !!(await db.kv.get("profile")), []);
}

export function useLatestBody() {
  return useLiveQuery(() => db.body.orderBy("date").last(), []);
}

/**
 * 화면에 쓸 목표값: 직접 지정한 값이 있으면 그것, 없으면 계산값.
 * date를 주고 "실제 활동 칼로리 반영"이 켜져 있으면 그날 건강 앱 활동 칼로리로 계산
 */
export function useTargets(date: string = todayStr()): { target: Nutrients | null; calc: TargetResult | null; hasProfile: boolean } {
  const profile = useProfile();
  const saved = useProfileSaved();
  const body = useLatestBody();
  const day = useLiveQuery(() => db.activity.get(date), [date]);
  const { target, calc } = resolveTarget(profile, saved, body, day, date);
  return { target, calc, hasProfile: !!saved && !!body };
}

/** 그날의 목표 (직접 지정 > 계산값, "실제 활동 칼로리 반영"이면 그날 활동 칼로리로) */
export function resolveTarget(profile: Profile | undefined, saved: boolean | undefined, body: BodyRecord | undefined, day: DayActivity | undefined, date: string) {
  const actual = profile?.useActualActivity && day?.activeKcal != null ? { activeKcal: day.activeKcal, isToday: date === todayStr() } : undefined;
  const calc = profile && saved ? calcTargets(profile, body, actual) : null;
  const target = (saved && profile?.override) || calc?.target || null;
  return { target, calc };
}

/** 여러 날짜의 목표를 한 번에 (주간 평가용) */
export function useTargetsFor(dates: string[]): Record<string, Nutrients | null> {
  const profile = useProfile();
  const saved = useProfileSaved();
  const body = useLatestBody();
  const from = dates[0], to = dates[dates.length - 1];
  const acts = useLiveQuery(() => db.activity.where("date").between(from, to, true, true).toArray(), [from, to], []);
  return Object.fromEntries(dates.map((d) => [d, resolveTarget(profile, saved, body, acts.find((a) => a.date === d), d).target]));
}
