// 치팅데이: 일주일(월~일)에 하루만 지정. 그날은 끼니·주간 평가, "식단을 잘 지켰는지" 판단에서 빠짐
import { useLiveQuery } from "dexie-react-hooks";
import { getKV, setKV } from "./db";
import { weekStartOf } from "./weekly";

const KEY = "cheatDays";

export const getCheatDays = () => getKV<string[]>(KEY, []);
export const useCheatDays = () => useLiveQuery(getCheatDays, [], [] as string[]);

/** 그날이 있는 주에 이미 지정한 치팅데이 (그날 말고) */
export const cheatInWeek = (days: string[], date: string) => days.find((d) => d !== date && weekStartOf(d) === weekStartOf(date));

/** 지정하면 같은 주의 다른 치팅데이는 풀림 (일주일에 하루) */
export async function setCheat(date: string, on: boolean) {
  const days = await getCheatDays();
  const rest = days.filter((d) => d !== date && (!on || weekStartOf(d) !== weekStartOf(date)));
  await setKV(KEY, on ? [...rest, date].sort() : rest);
}

/** 주간 화면에서 치팅데이 표시: 치킨·햄버거·피자 중 하나 (날짜마다 정해져 있어서 화면을 다시 그려도 그대로) */
const CHEAT_EMOJIS = ["🍗", "🍔", "🍕"];
export function cheatEmoji(date: string): string {
  const n = [...date].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  return CHEAT_EMOJIS[Math.abs(n) % CHEAT_EMOJIS.length];
}
