// 목표 칼로리 / 탄단지 계산
import type { BodyRecord, ExerciseKind, Goal, Meal, Nutrients, Profile } from "./db";

export const ACTIVITY = [
  { value: 1, label: "주로 앉아서 생활", factor: 1.2 },
  { value: 2, label: "가볍게 움직임 (출퇴근, 집안일)", factor: 1.35 },
  { value: 3, label: "서서 일하거나 많이 걸음", factor: 1.5 },
  { value: 4, label: "몸을 많이 쓰는 일", factor: 1.65 },
] as const;

// 운동 종류별 강도 (MET: 가만히 있을 때의 몇 배를 쓰는지)
export const EXERCISES: Record<ExerciseKind, { label: string; hint: string; met: number }> = {
  strength: { label: "근력운동", hint: "웨이트 트레이닝", met: 5.0 },
  interval: { label: "인터벌", hint: "HIIT", met: 8.5 },
  zone2: { label: "존2 유산소", hint: "대화 가능한 강도", met: 5.5 },
};

export const GOALS: Record<Goal, { label: string; kcal: number; proteinPerKg: number; desc: string }> = {
  cut: { label: "컷팅", kcal: 0.8, proteinPerKg: 2.2, desc: "소모량의 80% (체지방 감량)" },
  maintain: { label: "유지", kcal: 1.0, proteinPerKg: 1.6, desc: "소모량 그대로" },
  leanbulk: { label: "린매스업", kcal: 1.05, proteinPerKg: 2.0, desc: "소모량보다 5% 많이 (지방은 적게 늘리며 근육 증가)" },
  bulk: { label: "벌크업", kcal: 1.1, proteinPerKg: 1.8, desc: "소모량보다 10% 많이" },
};
export const GOAL_ORDER: Goal[] = ["cut", "maintain", "leanbulk", "bulk"];

export const DEFAULT_PROFILE: Profile = {
  sex: "male",
  birthYear: 1995,
  height: 170,
  activity: 2,
  exercise: {
    strength: { days: 4, minutes: 55 },
    interval: { days: 3, minutes: 15 },
    zone2: { days: 3, minutes: 45 },
  },
  goal: "maintain",
  override: null,
};

/** 하루 나트륨 권장 상한 (WHO 권고 2,000mg) */
export const SODIUM_LIMIT = 2000;

/** 탄단지로 칼로리 계산 (탄수화물·단백질 4kcal/g, 지방 9kcal/g) */
export const kcalFromMacros = (carb: number, protein: number, fat: number) => Math.round(carb * 4 + protein * 4 + fat * 9);

// ---------- 끼니 평가 ----------
/** 하루 목표를 끼니별로 나눈 비율 */
export const MEAL_SHARE: Record<Meal, number> = { breakfast: 0.25, lunch: 0.35, snack: 0.1, dinner: 0.3 };

export type Grade = "bad" | "ok" | "good";
export const GRADE_EMOJI: Record<Grade, string> = { bad: "😡", ok: "😀", good: "☺️" };

// 목표별로 끼니 칼로리가 끼니 몫의 몇 배면 좋은지/괜찮은지
const KCAL_RANGE: Record<Goal, { good: [number, number]; ok: [number, number] }> = {
  cut: { good: [0.6, 1.05], ok: [0.4, 1.25] },
  maintain: { good: [0.75, 1.15], ok: [0.5, 1.35] },
  leanbulk: { good: [0.85, 1.2], ok: [0.6, 1.4] },
  bulk: { good: [0.9, 1.3], ok: [0.65, 1.5] },
};

export interface MealEvaluation {
  grade: Grade;
  reasons: { grade: Grade; text: string }[];
}

/**
 * 끼니 하나를 목표의 끼니 몫과 비교해서 평가.
 * 칼로리·단백질은 2배 비중, 지방·나트륨은 1배. 점수 비율 80% 이상 ☺️, 50% 이상 😀, 그 아래 😡
 */
export function evaluateMeal(meal: Meal, total: Nutrients, target: Nutrients, goal: Goal): MealEvaluation {
  const share = MEAL_SHARE[meal];
  const reasons: MealEvaluation["reasons"] = [];
  let score = 0;
  let max = 0;
  const add = (grade: Grade, weight: number, text: string) => {
    score += (grade === "good" ? 2 : grade === "ok" ? 1 : 0) * weight;
    max += 2 * weight;
    reasons.push({ grade, text });
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // 칼로리
  const kr = total.kcal / (target.kcal * share);
  const range = KCAL_RANGE[goal];
  const kGrade: Grade = kr >= range.good[0] && kr <= range.good[1] ? "good" : kr >= range.ok[0] && kr <= range.ok[1] ? "ok" : "bad";
  add(kGrade, 2, `칼로리 ${Math.round(total.kcal)}kcal · 끼니 몫의 ${pct(kr)}${kGrade === "good" ? " (적당)" : kr > 1 ? " (많음)" : " (적음)"}`);

  // 단백질 (간식은 채점하지 않음)
  if (meal !== "snack") {
    const pr = total.protein / (target.protein * share);
    const pGrade: Grade = pr >= 0.8 ? "good" : pr >= 0.5 ? "ok" : "bad";
    add(pGrade, 2, `단백질 ${Math.round(total.protein)}g · 끼니 몫의 ${pct(pr)}${pGrade === "good" ? " (충분)" : " (부족)"}`);
  }

  // 지방
  const fr = total.fat / (target.fat * share);
  const fGrade: Grade = fr <= 1.3 ? "good" : fr <= 1.8 ? "ok" : "bad";
  add(fGrade, 1, `지방 ${Math.round(total.fat)}g · 끼니 몫의 ${pct(fr)}${fGrade === "good" ? "" : " (많음)"}`);

  // 나트륨
  const limit = (target.sodium ?? SODIUM_LIMIT) * share;
  const sr = (total.sodium ?? 0) / limit;
  const sGrade: Grade = sr <= 1.2 ? "good" : sr <= 1.8 ? "ok" : "bad";
  add(sGrade, 1, `나트륨 ${Math.round(total.sodium ?? 0)}mg · 끼니 상한의 ${pct(sr)}${sGrade === "good" ? "" : " (많음)"}`);

  const ratio = score / max;
  return { grade: ratio >= 0.8 ? "good" : ratio >= 0.5 ? "ok" : "bad", reasons };
}

export interface TargetResult {
  target: Nutrients;
  bmr: number;
  bmrMethod: string;
  tdee: number;
  exerciseKcal: number;
  exerciseDetail: { label: string; perWeek: number }[];
  notes: string[];
}

export function calcTargets(p: Profile, body: BodyRecord | undefined): TargetResult | null {
  if (!body?.weight || !p.height || !p.birthYear) return null;
  const w = body.weight;
  const age = new Date().getFullYear() - p.birthYear;
  const notes: string[] = [];

  let bmr: number;
  let bmrMethod: string;
  const lbm = body.bodyFat ? w * (1 - body.bodyFat / 100) : null;
  if (lbm) {
    bmr = 370 + 21.6 * lbm;
    bmrMethod = `제지방량 ${lbm.toFixed(1)}kg 기준 (Katch-McArdle 공식)`;
  } else {
    bmr = 10 * w + 6.25 * p.height - 5 * age + (p.sex === "male" ? 5 : -161);
    bmrMethod = "체중·키·나이 기준 (Mifflin-St Jeor 공식)";
  }

  const factor = ACTIVITY.find((a) => a.value === p.activity)?.factor ?? 1.2;
  // 운동 소모량: 휴식 대사량을 뺀 순 소모량 (MET-1) × 체중 × 시간, 일주일 합계를 7로 나눠 하루 평균
  const exerciseDetail = (Object.keys(EXERCISES) as ExerciseKind[]).map((k) => {
    const { days, minutes } = p.exercise[k] ?? { days: 0, minutes: 0 };
    return { label: EXERCISES[k].label, perWeek: Math.round((days || 0) * ((minutes || 0) / 60) * (EXERCISES[k].met - 1) * w) };
  });
  const exerciseKcal = exerciseDetail.reduce((s, e) => s + e.perWeek, 0) / 7;
  const tdee = bmr * factor + exerciseKcal;

  const goal = GOALS[p.goal];
  let kcal = tdee * goal.kcal;
  if (p.goal === "cut" && kcal < bmr) {
    kcal = bmr;
    notes.push("감량 중에도 기초대사량 아래로는 내려가지 않게 맞췄어요.");
  }
  kcal = Math.round(kcal / 10) * 10;

  // 체지방이 많으면 체중 대신 제지방량 기준으로 단백질 계산
  const highFat = body.bodyFat && body.bodyFat > (p.sex === "male" ? 25 : 32);
  const protein = Math.round(highFat && lbm ? lbm * 2.3 : w * goal.proteinPerKg);
  if (highFat) notes.push("체지방률이 높아서 단백질은 제지방량 기준으로 계산했어요.");
  const fat = Math.round(Math.max((kcal * 0.25) / 9, w * 0.6));
  const carb = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return {
    target: { kcal, carb, protein, fat, sodium: SODIUM_LIMIT },
    bmr: Math.round(bmr),
    bmrMethod,
    tdee: Math.round(tdee),
    exerciseKcal: Math.round(exerciseKcal),
    exerciseDetail,
    notes,
  };
}
