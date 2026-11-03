// 내 정보(목표·칼로리 조정 등)가 언제부터 무엇이었는지 기억.
// 지난 날의 목표·평가는 그때의 정보로 계산 (예: 지난주까지 컷팅, 이번 주부터 벌크업이면 지난주는 컷팅 기준)
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, setKV, todayStr, type Profile } from "./db";
import { DEFAULT_PROFILE } from "./nutrition";

export interface ProfileSnap { from: string; profile: Profile }

const KEY = "profileHistory";
/** 기록을 남기기 전부터 쓰던 정보 */
const BEGIN = "0000-01-01";

export const getProfileHistory = () => getKV<ProfileSnap[]>(KEY, []);
export const useProfileHistory = () => useLiveQuery(getProfileHistory, [], [] as ProfileSnap[]);

/** 그날 쓰던 정보 (오늘·앞으로는 지금 정보) */
export function profileOn(history: ProfileSnap[], current: Profile | undefined, date: string): Profile | undefined {
  if (!current || !history.length || date >= todayStr()) return current;
  let p = history[0].profile;
  for (const h of history) {
    if (h.from > date) break;
    p = h.profile;
  }
  return p;
}

/** 목표(컷팅·벌크업 등)를 마지막으로 바꾼 날 */
export function lastGoalChange(history: ProfileSnap[]): string | undefined {
  let at: string | undefined;
  for (let i = 1; i < history.length; i++) if (history[i].profile.goal !== history[i - 1].profile.goal) at = history[i].from;
  return at;
}

/** 내 정보 저장 + 오늘부터 이 정보라고 기록 (같은 날 여러 번 바꾸면 마지막 것만) */
export async function saveProfile(next: Profile) {
  const today = todayStr();
  const hist = await getProfileHistory();
  if (!hist.length && (await db.kv.get("profile"))) hist.push({ from: BEGIN, profile: await getKV("profile", DEFAULT_PROFILE) });
  const rest = hist.filter((h) => h.from !== today);
  await setKV("profile", next);
  await setKV(KEY, [...rest, { from: today, profile: next }]);
}
