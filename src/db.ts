import Dexie, { type EntityTable } from "dexie";

export type Meal = "breakfast" | "lunch" | "snack" | "dinner";
export const MEALS: { key: Meal; label: string; icon: string }[] = [
  { key: "breakfast", label: "아침", icon: "🌅" },
  { key: "lunch", label: "점심", icon: "☀️" },
  { key: "snack", label: "간식", icon: "🍪" },
  { key: "dinner", label: "저녁", icon: "🌙" },
];

export interface Nutrients {
  kcal: number;
  carb: number;
  protein: number;
  fat: number;
  sugar?: number;
  sodium?: number;
}

export type ItemSource = "db" | "ai" | "manual" | "saved";

/** 한 끼 기록 안의 음식/식재료 한 줄 */
export interface Item {
  name: string; // 표시 이름 (사용자 입력)
  amountText: string; // "200g", "2개", "1인분"
  grams: number | null;
  source: ItemSource;
  matchName?: string; // DB에서 매칭된 식품명
  nutrients: Nutrients;
}

/** out=외식, home=조리(집에서 요리), food=식품(바로 먹는 제품·과일 등), manual=직접 입력 */
export type EntryKind = "out" | "home" | "food" | "manual";
export const KIND_LABEL: Record<EntryKind, string> = { out: "외식", home: "조리", food: "식품", manual: "직접" };

export interface Entry {
  id?: number;
  date: string; // YYYY-MM-DD
  meal: Meal;
  kind: EntryKind;
  title: string;
  place?: string; // 외식 가게 이름 / 식품 제조사
  items: Item[];
  total: Nutrients;
  /** 양 조절 배수 (items·total은 이 배수로 먹은 양, 기준 1회 제공량 = 먹은 양 ÷ k). 없으면 1 */
  k?: number;
  memo?: string;
  createdAt: number;
}

export interface BodyRecord {
  id?: number;
  date: string;
  weight: number;
  bodyFat?: number; // 체지방률 %
  muscle?: number; // 골격근량 kg
  bmr?: number; // 인바디 기초대사량
  source: "manual" | "inbody" | "health"; // health = 건강 앱에서 가져옴
}

/** 한 번 찾은 메뉴/식재료를 다시 쓰기 위한 저장소 */
export interface SavedFood {
  key: string;
  kind: Entry["kind"];
  title: string;
  place?: string;
  items: Item[];
  total: Nutrients;
  k?: number; // 양 조절 배수 (Entry.k와 같음)
  uses: number;
  updatedAt: number;
  /** @deprecated v3부터 groupId 사용 */
  fav?: boolean;
  groupId?: number; // 즐겨찾기 그룹. 없으면 "최근"에만 보임
}

/** 즐겨찾기 그룹 */
export interface FavGroup {
  id?: number;
  name: string;
  order: number;
  emoji?: string; // 폴더 아이콘
}

export const FOLDER_EMOJIS = ["🍚", "🍳", "🥗", "🍗", "🥩", "🐟", "🍜", "🍞", "🥛", "🍎", "🍌", "🥜", "🍫", "🍰", "☕", "🥤", "🍕", "🍔", "🍱", "🥚", "🧀", "💪", "🔥", "⭐"];
export const folderEmoji = (g: FavGroup) => g.emoji ?? "📁";

/** 자주 먹는 식단 묶음. 한 번에 여러 개를 기록 */
export interface MealSet {
  id?: number;
  name: string;
  entries: { kind: EntryKind; title: string; place?: string; items: Item[]; k?: number }[];
  total: Nutrients;
  updatedAt: number;
}

/** 건강 앱(Health Connect·HealthKit·아이폰 단축어)에서 가져온 하루 활동 */
export interface Workout {
  type: string; // 운동 종류 (한국어로 바꾼 이름)
  start?: string; // ISO 시각
  minutes: number;
  kcal?: number;
}
export interface DayActivity {
  date: string; // YYYY-MM-DD
  steps?: number;
  activeKcal?: number;
  exerciseMin?: number; // 아이폰 "운동하기 시간" (운동 기록과 별개로 집계되는 하루 운동 분)
  workouts: Workout[];
  source: "healthconnect" | "healthkit" | "shortcut";
  syncedAt: number;
}

export interface KV {
  key: string;
  value: unknown;
}

export const db = new Dexie("meal-log") as Dexie & {
  entries: EntityTable<Entry, "id">;
  body: EntityTable<BodyRecord, "id">;
  saved: EntityTable<SavedFood, "key">;
  sets: EntityTable<MealSet, "id">;
  groups: EntityTable<FavGroup, "id">;
  activity: EntityTable<DayActivity, "date">;
  kv: EntityTable<KV, "key">;
};

db.version(1).stores({
  entries: "++id, date, createdAt",
  body: "++id, date",
  saved: "key, updatedAt",
  kv: "key",
});
db.version(2).stores({ sets: "++id, updatedAt" });
// v3: 즐겨찾기 그룹. 예전 ⭐(fav)는 "기본" 그룹으로 옮김
db.version(3)
  .stores({ groups: "++id, order" })
  .upgrade(async (tx) => {
    const id = await tx.table("groups").add({ name: "기본", order: 0, emoji: "⭐" });
    await tx.table("saved").toCollection().modify((s: SavedFood) => {
      if (s.fav) s.groupId = id as number;
      delete s.fav;
    });
  });
db.version(4).stores({ activity: "date" });

// 새로 설치한 경우에도 "기본" 그룹이 항상 있게
db.on("ready", async () => {
  if ((await db.groups.count()) === 0) await db.groups.add({ name: "기본", order: 0, emoji: "⭐" });
  // 이모지가 생기기 전에 만든 "기본" 폴더
  await db.groups.filter((g) => !g.emoji && g.name === "기본").modify({ emoji: "⭐" });
});

// ---------- 프로필 / 설정 ----------
export type Sex = "male" | "female";
export type Goal = "cut" | "maintain" | "leanbulk" | "bulk";
export type ExerciseKind = "strength" | "interval" | "zone2";

export interface Profile {
  sex: Sex;
  birthYear: number;
  height: number;
  activity: 1 | 2 | 3 | 4;
  /** 운동 종류별 일주일 횟수와 1회 시간(분) */
  exercise: Record<ExerciseKind, { days: number; minutes: number }>;
  goal: Goal;
  override?: Nutrients | null; // 목표를 직접 지정한 경우
  useActualActivity?: boolean; // 건강 앱의 실제 활동 칼로리로 그날 목표 계산
}

export interface Settings {
  geminiKey: string;
  geminiModel: string;
}

export const DEFAULT_SETTINGS: Settings = { geminiKey: "", geminiModel: "gemini-3.8-flash" };

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? ({ ...fallback, ...(row.value as object) } as T) : fallback;
}
export async function setKV(key: string, value: unknown) {
  await db.kv.put({ key, value });
}

// ---------- 공통 유틸 ----------
export const ZERO: Nutrients = { kcal: 0, carb: 0, protein: 0, fat: 0, sugar: 0, sodium: 0 };

export const r1 = (v: number) => Math.round(v * 10) / 10;

export function sumNutrients(list: Nutrients[]): Nutrients {
  const t = { ...ZERO } as Required<Nutrients>;
  for (const n of list) {
    t.kcal += n.kcal || 0;
    t.carb += n.carb || 0;
    t.protein += n.protein || 0;
    t.fat += n.fat || 0;
    t.sugar += n.sugar || 0;
    t.sodium += n.sodium || 0;
  }
  return { kcal: Math.round(t.kcal), carb: r1(t.carb), protein: r1(t.protein), fat: r1(t.fat), sugar: r1(t.sugar), sodium: Math.round(t.sodium) };
}

export function scaleNutrients(n: Nutrients, k: number): Nutrients {
  return {
    kcal: n.kcal * k,
    carb: n.carb * k,
    protein: n.protein * k,
    fat: n.fat * k,
    sugar: (n.sugar ?? 0) * k,
    sodium: (n.sodium ?? 0) * k,
  };
}

export function todayStr() {
  return toDateStr(new Date());
}
export function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}
export function formatDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const w = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 (${w})`;
}

/** 저장된 메뉴를 찾기 위한 키 (공백/대소문자 무시) */
export const savedKey = (kind: string, place: string | undefined, title: string) =>
  `${kind}|${(place ?? "").replace(/\s+/g, "").toLowerCase()}|${title.replace(/\s+/g, "").toLowerCase()}`;
