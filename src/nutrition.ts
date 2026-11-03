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
export const ADJUST_COOLDOWN_DAYS = 7;

const dayNum = (date: string) => Math.round(new Date(date + "T00:00:00").getTime() / 86400000);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 하루 식단 (잘 지켰는지 판단용) */
export interface DietDay { date: string; logged: boolean; kcal: number; target: number | null; cheat: boolean }

/** 목표별로 "잘 지켰다"고 볼 하루 평균 칼로리 범위 (목표 대비) */
const KEEP_RANGE: Record<Goal, [number, number]> = { cut: [0.85, 1.05], maintain: [0.9, 1.1], leanbulk: [0.95, 1.15], bulk: [0.95, 1.15] };
/** 기간 중 이만큼 이상 기록해야 잘 지켰다고 봄 */
const KEEP_LOGGED = 0.7;

/** 기간 동안 식단을 잘 지켰는지: 치팅데이를 뺀 날 중 70% 이상 기록, 기록한 날 평균 칼로리가 목표 범위 안 */
export function dietAdherence(goal: Goal, days: DietDay[]) {
  const pool = days.filter((d) => !d.cheat);
  const logged = pool.filter((d) => d.logged && d.target);
  const cheats = days.length - pool.length;
  const rate = pool.length ? logged.length / pool.length : 0;
  const avgKcal = logged.length ? Math.round(avg(logged.map((d) => d.kcal))) : null;
  const avgTarget = logged.length ? Math.round(avg(logged.map((d) => d.target!))) : null;
  const [lo, hi] = KEEP_RANGE[goal];
  const inRange = avgKcal != null && avgTarget != null && avgKcal >= avgTarget * lo && avgKcal <= avgTarget * hi;
  const ok = rate >= KEEP_LOGGED && inRange;
  const parts = [`기록 ${logged.length}/${pool.length}일`];
  if (avgKcal != null) parts.push(`평균 ${avgKcal.toLocaleString()}kcal (목표 ${avgTarget!.toLocaleString()})`);
  if (cheats) parts.push(`치팅데이 ${cheats}일 제외`);
  return { ok, text: parts.join(", "), lowLog: rate < KEEP_LOGGED };
}

/** 주당 변화량 (최소제곱 직선의 기울기 × 7) */
function weeklySlope(pts: { d: number; v: number }[]) {
  const mx = avg(pts.map((p) => p.d));
  const my = avg(pts.map((p) => p.v));
  const den = pts.reduce((a, p) => a + (p.d - mx) ** 2, 0);
  return den ? (pts.reduce((a, p) => a + (p.d - mx) * (p.v - my), 0) / den) * 7 : 0;
}

/** 목표 쪽으로 가고 있다고 볼 주당 변화 (컷팅은 이만큼 이상 줄고, 벌크업은 이만큼 이상 늘면) */
const TREND_MIN = { bodyFat: 0.1, muscle: 0.05, weightCut: 0.2, weightBulk: 0.1 };

/**
 * 식단을 기록한 기간(since부터, 칼로리를 조정했으면 그날부터)의 인바디·체중 기록 전체로 추세를 봄.
 * - 컷팅은 체지방률, 린매스업·벌크업은 골격근량 추세 (그 값이 있는 기록이 모자라면 체중 추세)
 * - 기록이 2개 이상, 처음과 끝이 14일 이상 떨어져 있어야 판단
 * - 목표 쪽으로 가고 있으면 그대로. 안 가고 있으면 그 기간 식단을 잘 지켰는지 보고:
 *   잘 지켰으면 칼로리 조정 제안, 못 지켰으면 조정하지 않고 이유를 알려 줌
 * - 예전 날짜를 새로 넣은 경우 판단하지 않음. 한 번 물으면 1주일 동안은 다시 묻지 않음
 */
export function suggestAdjust(
  goal: Goal, now: BodyRecord, history: BodyRecord[],
  opts: { since: string; diet: DietDay[]; currentAdjust?: number; lastAsked?: string },
): AdjustSuggestion | null {
  const cut = goal === "cut";
  if (!cut && goal !== "leanbulk" && goal !== "bulk") return { delta: 0, text: "목표가 유지라서 칼로리 조정은 제안하지 않아요" };
  const others = history.filter((r) => r.id !== now.id);
  if (others.some((r) => r.date > now.date)) return null; // 예전 날짜 기록: 판단하지 않음
  const recs = [...others.filter((r) => r.date >= opts.since && r.date <= now.date), now].sort((a, b) => a.date.localeCompare(b.date));
  const span = (rs: BodyRecord[]) => (rs.length >= 2 ? dayNum(rs[rs.length - 1].date) - dayNum(rs[0].date) : 0);

  const key = cut ? "bodyFat" : "muscle";
  const withKey = recs.filter((r) => r[key] != null);
  const useKey = withKey.length >= 2 && span(withKey) >= 14;
  const pts = useKey ? withKey : recs;
  if (span(pts) < 14) return { delta: 0, text: "식단을 기록한 기간에 2주 이상 떨어진 체중·인바디 기록이 2개 이상 생기면 추세를 보고 알려 드릴게요" };

  const slope = weeklySlope(pts.map((r) => ({ d: dayNum(r.date), v: (useKey ? r[key] : r.weight) as number })));
  const label = useKey ? (cut ? "체지방률" : "골격근량") : "체중";
  const unit = useKey && cut ? "%p" : "kg";
  const min = useKey ? (cut ? TREND_MIN.bodyFat : TREND_MIN.muscle) : cut ? TREND_MIN.weightCut : TREND_MIN.weightBulk;
  const progressed = cut ? slope <= -min : slope >= min;
  const md = (d: string) => d.slice(5).split("-").map(Number).join("/");
  const change = Math.abs(slope) < 0.01 ? "거의 그대로예요" : `일주일에 ${Math.abs(slope).toFixed(2)}${unit}씩 ${slope > 0 ? "늘고" : "줄고"} 있어요`;
  const text = `${md(pts[0].date)}~${md(now.date)} 기록 ${pts.length}개로 보면 ${label}이 ${change}`;
  if (progressed) return { delta: 0, text: `${text}. 잘 되고 있어서 칼로리는 그대로 둘게요` };

  // 추세를 본 기간에 식단을 잘 지켰는지 (마지막 기록 날은 아직 진행 중이라 뺌)
  const diet = dietAdherence(goal, opts.diet.filter((d) => d.date >= pts[0].date && d.date < now.date));
  if (!diet.ok) {
    const why = diet.lowLog ? "기록한 날이 적어서" : "평균 칼로리가 목표와 달라서";
    return { delta: 0, text: `${text}. 다만 이 기간 ${why}(${diet.text}) 칼로리는 그대로 둘게요. 먼저 목표대로 드셔 보세요` };
  }
  const today = dayNum(now.date);
  if (opts.lastAsked && today - dayNum(opts.lastAsked) < ADJUST_COOLDOWN_DAYS) {
    return { delta: 0, text: `${text}. 칼로리 조정은 ${md(opts.lastAsked)}에 물어봐서 1주 뒤에 다시 볼게요` };
  }
  const delta = cut ? -ADJUST_STEP : ADJUST_STEP;
  if (Math.abs((opts.currentAdjust ?? 0) + delta) > ADJUST_MAX) return { delta: 0, text: `${text}. 이미 ${ADJUST_MAX}kcal까지 조정해서 더 바꾸지 않아요` };
  return { delta, text: `${text}. 이 기간 식단은 잘 지키셨어요(${diet.text})` };
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
