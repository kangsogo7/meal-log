// 목표 칼로리 / 탄단지 계산
import type { BodyRecord, ExerciseKind, Goal, Nutrients, Profile } from "./db";

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

/** 탄단지로 칼로리 계산 (탄수화물·단백질 4kcal/g, 지방 9kcal/g) */
export const kcalFromMacros = (carb: number, protein: number, fat: number) => Math.round(carb * 4 + protein * 4 + fat * 9);

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
    target: { kcal, carb, protein, fat },
    bmr: Math.round(bmr),
    bmrMethod,
    tdee: Math.round(tdee),
    exerciseKcal: Math.round(exerciseKcal),
    exerciseDetail,
    notes,
  };
}
