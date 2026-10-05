// 목표 칼로리 / 탄단지 계산
import type { BodyRecord, Nutrients, Profile } from "./db";

export const ACTIVITY = [
  { value: 1, label: "주로 앉아서 생활", factor: 1.2 },
  { value: 2, label: "가볍게 움직임 (출퇴근, 집안일)", factor: 1.35 },
  { value: 3, label: "서서 일하거나 많이 걸음", factor: 1.5 },
  { value: 4, label: "몸을 많이 쓰는 일", factor: 1.65 },
] as const;

export const INTENSITY = {
  light: { label: "가볍게 (걷기, 요가)", met: 3.5 },
  moderate: { label: "보통 (웨이트, 조깅)", met: 5.5 },
  hard: { label: "강하게 (고강도 웨이트, 러닝, 크로스핏)", met: 8 },
} as const;

export const GOALS = {
  cut: { label: "체지방 감량", kcal: 0.8, proteinPerKg: 2.0 },
  maintain: { label: "유지", kcal: 1.0, proteinPerKg: 1.6 },
  bulk: { label: "벌크업", kcal: 1.1, proteinPerKg: 1.8 },
} as const;

export const DEFAULT_PROFILE: Profile = {
  sex: "male",
  birthYear: 1995,
  height: 170,
  activity: 2,
  exerciseDays: 3,
  exerciseMinutes: 60,
  exerciseIntensity: "moderate",
  goal: "maintain",
  override: null,
};

export interface TargetResult {
  target: Nutrients;
  bmr: number;
  bmrMethod: string;
  tdee: number;
  exerciseKcal: number;
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
  const met = INTENSITY[p.exerciseIntensity].met;
  // 하루 평균 운동 소모량 (휴식 대사량을 뺀 순 소모량)
  const exerciseKcal = ((p.exerciseDays / 7) * (p.exerciseMinutes / 60) * (met - 1) * w) || 0;
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
    notes,
  };
}
