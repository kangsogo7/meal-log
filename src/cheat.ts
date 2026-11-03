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
