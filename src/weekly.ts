// 주간 평가: 월~일 한 주 동안 하루하루 목표에 맞게 먹었는지
import { addDays, sumNutrients, todayStr, type Entry, type Nutrients } from "./db";
import { SODIUM_LIMIT, type Grade } from "./nutrition";

/** 그 날짜가 속한 주의 월요일 */
export function weekStartOf(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=일
  return addDays(date, -((dow + 6) % 7));
}

export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const weekLabel = (start: string) => {
  const f = (s: string) => s.split("-").slice(1).map(Number).join("/");
  return `${f(start)} ~ ${f(addDays(start, 6))}`;
};

/** 항목별 판정 기준 (하루 섭취 ÷ 하루 목표) */
export const CRITERIA = {
  kcal: { label: "칼로리", weight: 2, rule: "목표 ±10% 안" },
  protein: { label: "단백질", weight: 2, rule: "목표의 90% 이상" },
  carb: { label: "탄수화물", weight: 1, rule: "목표 ±20% 안" },
  fat: { label: "지방", weight: 1, rule: "목표 ±20% 안" },
  sodium: { label: "나트륨", weight: 1, rule: "상한 이하" },
} as const;
export type Criterion = keyof typeof CRITERIA;
export const CRITERIA_ORDER: Criterion[] = ["kcal", "protein", "carb", "fat", "sodium"];

function gradeOf(c: Criterion, ratio: number): Grade {
  switch (c) {
    case "kcal":
      return Math.abs(ratio - 1) <= 0.1 ? "good" : Math.abs(ratio - 1) <= 0.2 ? "ok" : "bad";
    case "protein":
      return ratio >= 0.9 ? "good" : ratio >= 0.7 ? "ok" : "bad";
    case "carb":
    case "fat":
      return Math.abs(ratio - 1) <= 0.2 ? "good" : Math.abs(ratio - 1) <= 0.35 ? "ok" : "bad";
    case "sodium":
      return ratio <= 1 ? "good" : ratio <= 1.3 ? "ok" : "bad";
  }
}

export interface DayResult {
  date: string;
  /** none = 기록 없음, today = 오늘(아직 진행 중, 점수에 넣지 않음), future = 아직 안 온 날 */
  status: "scored" | "none" | "today" | "future";
  total: Nutrients;
  target: Nutrients | null;
  score?: number; // 0~100
  grade?: Grade;
  items?: Record<Criterion, { ratio: number; grade: Grade }>;
}

const valueOf = (n: Nutrients, c: Criterion) => (c === "sodium" ? n.sodium ?? 0 : n[c]);
const targetOf = (t: Nutrients, c: Criterion) => (c === "sodium" ? t.sodium ?? SODIUM_LIMIT : t[c]);
export const gradeOfScore = (s: number): Grade => (s >= 80 ? "good" : s >= 50 ? "ok" : "bad");

export function evaluateDay(date: string, entries: Entry[], target: Nutrients | null): DayResult {
  const total = sumNutrients(entries.map((e) => e.total));
  const today = todayStr();
  if (date > today) return { date, status: "future", total, target };
  if (!entries.length) return { date, status: "none", total, target };
  if (date === today || !target) return { date, status: "today", total, target };
  let score = 0;
  let max = 0;
  const items = {} as NonNullable<DayResult["items"]>;
  for (const c of CRITERIA_ORDER) {
    const t = targetOf(target, c);
    const ratio = t > 0 ? valueOf(total, c) / t : 0;
    const grade = gradeOf(c, ratio);
    items[c] = { ratio, grade };
    score += (grade === "good" ? 2 : grade === "ok" ? 1 : 0) * CRITERIA[c].weight;
    max += 2 * CRITERIA[c].weight;
  }
  const s = Math.round((score / max) * 100);
  return { date, status: "scored", total, target, score: s, grade: gradeOfScore(s), items };
}

export interface WeekResult {
  days: DayResult[];
  scored: DayResult[];
  score: number | null;
  grade: Grade | null;
  /** 항목별: 평균 섭취, 평균 목표, 잘 지킨 날(good) 수 */
  summary: Record<Criterion, { avg: number; target: number; good: number }>;
}

export function evaluateWeek(days: DayResult[]): WeekResult {
  const scored = days.filter((d) => d.status === "scored");
  const score = scored.length ? Math.round(scored.reduce((s, d) => s + d.score!, 0) / scored.length) : null;
  const summary = {} as WeekResult["summary"];
  for (const c of CRITERIA_ORDER) {
    const n = scored.length || 1;
    summary[c] = {
      avg: Math.round(scored.reduce((s, d) => s + valueOf(d.total, c), 0) / n),
      target: Math.round(scored.reduce((s, d) => s + targetOf(d.target!, c), 0) / n),
      good: scored.filter((d) => d.items![c].grade === "good").length,
    };
  }
  return { days, scored, score, grade: score == null ? null : gradeOfScore(score), summary };
}
