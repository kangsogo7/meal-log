import { useLiveQuery } from "dexie-react-hooks";
import { db, DEFAULT_SETTINGS, getKV, type Nutrients, type Profile, type Settings } from "./db";
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

/** 화면에 쓸 목표값: 직접 지정한 값이 있으면 그것, 없으면 계산값 */
export function useTargets(): { target: Nutrients | null; calc: TargetResult | null; hasProfile: boolean } {
  const profile = useProfile();
  const saved = useProfileSaved();
  const body = useLatestBody();
  const calc = profile && saved ? calcTargets(profile, body) : null;
  const target = (saved && profile?.override) || calc?.target || null;
  return { target, calc, hasProfile: !!saved && !!body };
}
