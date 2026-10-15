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

// ---------- 체성분 변화 → 칼로리 조정 제안 ----------
/** 한 번에 조정하는 칼로리, 누적 한도 */
export const ADJUST_STEP = 150;
const ADJUST_MAX = 450;

export interface AdjustSuggestion {
  delta: number; // +150 / -150, 0이면 제안 없음 (text에 이유)
  text: string; // "2주 전(9월 27일)보다 체지방률이 0.2%p 줄었어요"
}

/** 제안을 한 번 보여 주면(줄이기·그대로 모두) 이 기간 동안은 다시 묻지 않음 */
export const ADJUST_COOLDOWN_DAYS = 14;

const dayNum = (date: string) => Math.round(new Date(date + "T00:00:00").getTime() / 86400000);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * 새 기록을 2~5주 전 기록과 비교해서, 목표 쪽으로 변화가 없으면 칼로리 조정을 제안.
 * - 비교 대상: 14~35일 전 기록만 (몇 달 전 기록과는 비교하지 않음)
 * - 체중은 하루 오차가 커서 평균끼리: 최근 7일 평균 vs 14~21일 전 평균 (없으면 14~35일 전 중 가장 최근 7일 평균)
 * - 체지방률·골격근량(인바디)은 기록 하나끼리
 * - 컷팅: 체지방률(없으면 체중)이 0.5%p(0.3kg) 넘게 줄지 않았으면 줄이기 / 린매스업·벌크업: 골격근량(없으면 체중)이 0.3kg 넘게 늘지 않았으면 늘리기
 * - 예전 날짜를 새로 넣은 경우, 마지막 제안 뒤 2주가 안 됐으면 묻지 않음
 */
export function suggestAdjust(goal: Goal, now: BodyRecord, history: BodyRecord[], currentAdjust = 0, lastAsked?: string): AdjustSuggestion | null {
  const cut = goal === "cut";
  if (!cut && goal !== "leanbulk" && goal !== "bulk") return { delta: 0, text: "목표가 유지라서 칼로리 조정은 제안하지 않아요" };
  const others = history.filter((r) => r.id !== now.id);
  if (others.some((r) => r.date > now.date)) return null; // 예전 날짜 기록: 비교하지 않음
  const today = dayNum(now.date);
  const ago = (r: BodyRecord) => today - dayNum(r.date);
  const win = others.filter((r) => ago(r) >= 14 && ago(r) <= 35).sort((a, b) => b.date.localeCompare(a.date));
  if (!win.length) return { delta: 0, text: "비교할 2~5주 전 기록이 없어서 아직 칼로리 조정은 제안하지 않아요" };

  const key = cut ? "bodyFat" : "muscle";
  const keyBase = now[key] != null ? win.find((r) => r[key] != null) : undefined;
  let diff: number, label: string, unit: string, since: string;
  if (keyBase) {
    diff = (now[key] as number) - (keyBase[key] as number);
    label = cut ? "체지방률" : "골격근량";
    unit = cut ? "%p" : "kg";
    since = `${ago(keyBase)}일 전(${keyBase.date.slice(5).split("-").map(Number).join("/")})보다`;
  } else {
    const recent = [now, ...others.filter((r) => ago(r) >= 0 && ago(r) < 7)];
    const near = win.filter((r) => ago(r) <= 21);
    const base = near.length ? near : win.filter((r) => dayNum(win[0].date) - dayNum(r.date) < 7);
    diff = avg(recent.map((r) => r.weight)) - avg(base.map((r) => r.weight));
    label = "체중";
    unit = "kg";
    // 평균끼리면 "최근 1주 평균 체중이 2~3주 전 평균보다 …"
    if (recent.length > 1 || base.length > 1) {
      label = "최근 1주 평균 체중";
      since = "";
      unit = "kg";
    } else since = `${ago(base[0])}일 전보다`;
  }
  const progressed = cut ? diff < -(keyBase ? 0.5 : 0.3) : diff > 0.3;
  const change = Math.abs(diff) < 0.05 ? "거의 변하지 않았어요" : `${Math.abs(diff).toFixed(1)}${unit} ${diff > 0 ? "늘었어요" : "줄었어요"}`;
  const text = since ? `${since} ${label}이 ${change}` : `${label}이 2~3주 전 평균보다 ${change}`;
  if (progressed) return { delta: 0, text: `${text}. 잘 되고 있어서 목표는 그대로 둘게요` };
  if (lastAsked && today - dayNum(lastAsked) < ADJUST_COOLDOWN_DAYS) {
    return { delta: 0, text: `${text}. 칼로리 조정은 ${lastAsked.slice(5).split("-").map(Number).join("/")}에 물어봐서 2주 뒤에 다시 볼게요` };
  }
  const delta = cut ? -ADJUST_STEP : ADJUST_STEP;
  if (Math.abs(currentAdjust + delta) > ADJUST_MAX) return { delta: 0, text: `${text}. 이미 ${ADJUST_MAX}kcal까지 조정해서 더 바꾸지 않아요` };
  return { delta, text };
}

// ---------- 끼니 평가 ----------
/** 하루 목표를 끼니별로 나눈 비율 */
export const MEAL_SHARE: Record<Meal, number> = { breakfast: 0.25, lunch: 0.35, snack: 0.1, dinner: 0.3 };

export type Grade = "bad" | "ok" | "good";
export const GRADE_EMOJI: Record<Grade, string> = { bad: "😡", ok: "😀", good: "☺️" };
/** 평가 글자 (색과 함께 표시: --good / --ok / --bad) */
export const GRADE_LABEL: Record<Grade, string> = { good: "좋음", ok: "보통", bad: "아쉬움" };

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
  /** 실제 활동 칼로리를 썼으면 그 값. usedEstimate = 오늘이라 아직 적어서 추정치를 씀 */
  actual?: { activeKcal: number; usedEstimate: boolean };
  notes: string[];
}

/**
 * @param actual 그날 건강 앱의 활동 칼로리. 주면 운동 횟수 추정 대신 실제 값으로 소모량 계산.
 *   오늘은 아직 하루가 안 끝났으니 추정치보다 적으면 추정치를 씀
 */
export function calcTargets(p: Profile, body: BodyRecord | undefined, actual?: { activeKcal: number; isToday: boolean }): TargetResult | null {
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
  let tdee = bmr * factor + exerciseKcal;
  let actualUsed: TargetResult["actual"];
  if (actual) {
    // 건강 앱의 활동 칼로리 = 기초대사량 외에 움직여서 쓴 칼로리. 소화에 쓰는 몫(기초대사량의 약 10%)을 더함
    // 활동량 계수(1.2~)에 이미 소화 몫 0.1이 들어 있으므로 빼서 맞춤 → 추정치를 쓰면 기존 계산과 같은 값
    const estimatedActive = bmr * (factor - 1.1) + exerciseKcal;
    const active = actual.isToday ? Math.max(actual.activeKcal, estimatedActive) : actual.activeKcal;
    tdee = bmr * 1.1 + active;
    actualUsed = { activeKcal: Math.round(actual.activeKcal), usedEstimate: active !== actual.activeKcal };
  }

  const goal = GOALS[p.goal];
  let kcal = tdee * goal.kcal;
  if (p.kcalAdjust) {
    kcal += p.kcalAdjust;
    notes.push(`체성분 변화를 보고 하루 ${Math.abs(p.kcalAdjust)}kcal ${p.kcalAdjust > 0 ? "늘렸어요" : "줄였어요"}.`);
  }
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
    actual: actualUsed,
    notes,
  };
}
