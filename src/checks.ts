// 물·영양제: 목표·목록은 kv에, 날짜별 체크는 kv "check:날짜"에 (백업에 같이 들어감)
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, setKV } from "./db";

export type When = "morning" | "lunch" | "dinner" | "bed";
export const WHEN: { key: When; label: string }[] = [
  { key: "morning", label: "아침" },
  { key: "lunch", label: "점심" },
  { key: "dinner", label: "저녁" },
  { key: "bed", label: "자기 전" },
];
export const whenLabel = (w: When) => WHEN.find((x) => x.key === w)!.label;

export interface Supplement {
  id: string;
  name: string;
  when: When;
  count: number; // 한 번에 몇 정
}
export interface Hydration {
  goalMl: number;
  cupMl: number;
}
export interface Reminders {
  supp: boolean;
  times: Record<When, string>; // "08:00"
  water: boolean;
  waterEvery: number; // 몇 시간마다
  waterFrom: string;
  waterTo: string;
}
export interface DayCheck {
  waterMl: number;
  supps: Record<string, number>; // 영양제 id → 먹은 시각
}

export const DEFAULT_HYDRATION: Hydration = { goalMl: 2000, cupMl: 250 };
export const DEFAULT_REMINDERS: Reminders = {
  supp: false,
  times: { morning: "08:00", lunch: "12:30", dinner: "18:30", bed: "22:30" },
  water: false,
  waterEvery: 2,
  waterFrom: "09:00",
  waterTo: "21:00",
};
const EMPTY_DAY: DayCheck = { waterMl: 0, supps: {} };
const dayKey = (date: string) => `check:${date}`;

export const getHydration = () => getKV("hydration", DEFAULT_HYDRATION);
export const getSupplements = async () => {
  const v = await getKV<Supplement[]>("supplements", []);
  return Array.isArray(v) ? v : [];
};
export const getReminders = async () => {
  const r = await getKV("reminders", DEFAULT_REMINDERS);
  return { ...r, times: { ...DEFAULT_REMINDERS.times, ...r.times } };
};
export const getDayCheck = async (date: string): Promise<DayCheck> => {
  const d = await getKV(dayKey(date), EMPTY_DAY);
  return { waterMl: d.waterMl || 0, supps: d.supps ?? {} };
};

export const useHydration = () => useLiveQuery(getHydration, [], DEFAULT_HYDRATION);
export const useSupplements = () => useLiveQuery(getSupplements, [], [] as Supplement[]);
export const useReminders = () => useLiveQuery(getReminders, [], DEFAULT_REMINDERS);
export const useDayCheck = (date: string) => useLiveQuery(() => getDayCheck(date), [date], EMPTY_DAY);

export const saveHydration = (h: Hydration) => setKV("hydration", h);
export const saveSupplements = (list: Supplement[]) => setKV("supplements", list);
export const saveReminders = (r: Reminders) => setKV("reminders", r);

export async function setWater(date: string, ml: number) {
  const d = await getDayCheck(date);
  await setKV(dayKey(date), { ...d, waterMl: Math.max(0, Math.round(ml)) });
}

/** 지금 저장된 양에 더하기 (빠르게 여러 번 눌러도 다 반영되게) */
export function addWater(date: string, deltaMl: number) {
  return db.transaction("rw", db.kv, async () => {
    const d = await getDayCheck(date);
    await setWater(date, d.waterMl + deltaMl);
  });
}

export async function toggleSupp(date: string, id: string) {
  const d = await getDayCheck(date);
  const supps = { ...d.supps };
  if (supps[id]) delete supps[id];
  else supps[id] = Date.now();
  await setKV(dayKey(date), { ...d, supps });
}

/** 영양제를 먹는 때 순서대로 */
export const sortSupps = (list: Supplement[]) =>
  [...list].sort((a, b) => WHEN.findIndex((w) => w.key === a.when) - WHEN.findIndex((w) => w.key === b.when));
