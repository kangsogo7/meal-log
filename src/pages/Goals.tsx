import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, setKV, todayStr, type BodyRecord, type ExerciseKind, type Goal, type Nutrients, type Profile } from "../db";
import { ACTIVITY, EXERCISES, GOAL_ORDER, GOALS, kcalFromMacros, SODIUM_LIMIT, calcTargets, suggestAdjust, type AdjustSuggestion } from "../nutrition";
import { useLatestBody, useProfile, useProfileSaved, useSettings, useTargets } from "../hooks";
import { GeminiError, imageToBase64, readInBody } from "../gemini";
import { Dialog, flash, NumInput, Sheet } from "../components/ui";
import { WeightChart } from "../components/charts";

export default function Goals() {
  const profile = useProfile();
  const saved = useProfileSaved();
  const latest = useLatestBody();
  const { target, calc } = useTargets();
  const records = useLiveQuery(() => db.body.orderBy("date").toArray(), [], []);
  const [bodyForm, setBodyForm] = useState<BodyRecord | null>(null);

  if (!profile) return null;
  const set = (patch: Partial<Profile>) => setKV("profile", { ...profile, ...patch });

  return (
    <>
      <header className="page-head"><h1>목표 · 체중</h1></header>

      <section className="card">
        <h2>하루 목표</h2>
        {target ? (
          <>
            <p className="target-kcal"><b>{target.kcal.toLocaleString()}</b> <span className="muted">kcal</span></p>
            <MacroBar n={target} />
            <div className="tone-tiles in-card">
              <div className="tone-tile carb"><span>탄수화물</span><b>{target.carb}<small>g</small></b></div>
              <div className="tone-tile protein"><span>단백질</span><b>{target.protein}<small>g</small></b></div>
              <div className="tone-tile fat"><span>지방</span><b>{target.fat}<small>g</small></b></div>
            </div>
            <div className="goal-row">
              <span className={`goal-chip ${profile.goal}`}>{GOALS[profile.goal].label}</span>
              <span className="muted small">
                {profile.override
                  ? "직접 정한 목표"
                  : profile.kcalAdjust
                    ? `체성분 변화로 ${profile.kcalAdjust > 0 ? "+" : ""}${profile.kcalAdjust}kcal 조정 중`
                    : GOALS[profile.goal].desc}
              </span>
              {!profile.override && !!profile.kcalAdjust && <button className="link small" onClick={() => set({ kcalAdjust: 0 })}>되돌리기</button>}
            </div>
            <p className="muted small">나트륨 {(target.sodium ?? SODIUM_LIMIT).toLocaleString()}mg 이하</p>
          </>
        ) : !saved ? (
          <>
            <p className="muted small">아래 "내 정보"를 내 값으로 고친 뒤 눌러 주세요.{!latest && " 체중도 기록해야 해요."}</p>
            <button className="primary block" onClick={() => setKV("profile", profile)}>이 정보로 목표 계산하기</button>
          </>
        ) : (
          <p className="muted small">체중을 기록하면 계산해 드려요.</p>
        )}

        {calc && !profile.override && (
          <details className="explain">
            <summary>어떻게 계산했나요?</summary>
            <ul className="small">
              <li>기초대사량 <b>{calc.bmr} kcal</b> · {calc.bmrMethod}{latest?.bmr ? ` (인바디 측정값: ${latest.bmr} kcal)` : ""}</li>
              {calc.actual ? (
                <li>
                  오늘 건강 앱 활동 칼로리 <b>{calc.actual.activeKcal} kcal</b>
                  {calc.actual.usedEstimate ? " (아직 하루가 덜 지나서 운동 횟수 기준 추정치 사용)" : ""}
                  → 기초대사량 × 1.1 + 활동 = 하루 소모량 <b>{calc.tdee} kcal</b>
                </li>
              ) : (
                <>
                  <li>
                    운동 소모량 일주일 {calc.exerciseDetail.map((e) => `${e.label} ${e.perWeek}`).join(" + ")} kcal
                    → 하루 평균 <b>{calc.exerciseKcal} kcal</b>
                  </li>
                  <li>기초대사량 × 평소 활동량 + 운동 = 하루 소모량 <b>{calc.tdee} kcal</b></li>
                </>
              )}
              <li>목표 "{GOALS[profile.goal].label}": {GOALS[profile.goal].desc} (× {GOALS[profile.goal].kcal})</li>
              <li>단백질은 체중 1kg당 {GOALS[profile.goal].proteinPerKg}g, 지방은 칼로리의 25%, 나머지는 탄수화물</li>
              {calc.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </details>
        )}

        <label className="switch">
          <input
            type="checkbox"
            checked={!!profile.override}
            onChange={(e) => set({ override: e.target.checked ? { ...(calc?.target ?? { kcal: 2000, carb: 250, protein: 100, fat: 60 }) } : null })}
          />
          목표를 직접 정하기
        </label>
        {profile.override && <MacroEditor n={profile.override} onChange={(n) => set({ override: n })} />}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>체중 · 인바디</h2>
        </div>
        {latest ? <BodyStats latest={latest} records={records} goal={profile.goal} /> : <p className="muted small">아직 기록이 없어요.</p>}
        <WeightChart points={records.map((r) => ({ date: r.date, weight: r.weight }))} />
        <div className="btn-row body-btns">
          <button className="primary" onClick={() => setBodyForm({ date: todayStr(), weight: latest?.weight ?? 0, source: "manual" })}>체중 기록</button>
          <InBodyButton onRead={setBodyForm} />
        </div>
        {records.length > 0 && (
          <details>
            <summary className="small">전체 기록 보기</summary>
            <ul className="mini-list body-list">
              {[...records].reverse().map((r) => (
                <li key={r.id}>
                  <span>{r.date} · {r.weight}kg{r.bodyFat ? ` · ${r.bodyFat}%` : ""}{r.muscle ? ` · 근육 ${r.muscle}kg` : ""}</span>
                  <button className="row-edit" onClick={() => setBodyForm(r)}>수정</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card form">
        <h2>내 정보</h2>
        <div className="seg">
          {(["male", "female"] as const).map((s) => (
            <button key={s} className={profile.sex === s ? "on" : ""} onClick={() => set({ sex: s })}>{s === "male" ? "남성" : "여성"}</button>
          ))}
        </div>
        <div className="two">
          <label>태어난 해<NumInput value={profile.birthYear} onChange={(v) => set({ birthYear: v ?? 0 })} step="1" /></label>
          <label>키 (cm)<NumInput value={profile.height} onChange={(v) => set({ height: v ?? 0 })} /></label>
        </div>
        <label>평소 활동량
          <select value={profile.activity} onChange={(e) => set({ activity: Number(e.target.value) as Profile["activity"] })}>
            {ACTIVITY.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label className="switch">
          <input type="checkbox" checked={!!profile.useActualActivity} onChange={(e) => set({ useActualActivity: e.target.checked })} />
          건강 앱의 실제 활동 칼로리로 목표 계산
        </label>
        {profile.useActualActivity && (
          <p className="muted small">활동 화면에 그날 데이터가 있으면 그 값으로, 없으면 아래 운동 기준으로 계산해요.</p>
        )}
        <p className="label">운동</p>
        <table className="ex-table">
          <thead>
            <tr><th></th><th>일주일에</th><th>한 번에</th></tr>
          </thead>
          <tbody>
            {(Object.keys(EXERCISES) as ExerciseKind[]).map((k) => {
              const ex = profile.exercise[k];
              const setEx = (patch: Partial<typeof ex>) => set({ exercise: { ...profile.exercise, [k]: { ...ex, ...patch } } });
              return (
                <tr key={k}>
                  <th>{EXERCISES[k].label}<span className="muted small">{EXERCISES[k].hint}</span></th>
                  <td><div className="with-unit"><NumInput value={ex.days} onChange={(v) => setEx({ days: Math.min(7, v ?? 0) })} step="1" /><em>회</em></div></td>
                  <td><div className="with-unit"><NumInput value={ex.minutes} onChange={(v) => setEx({ minutes: v ?? 0 })} step="5" /><em>분</em></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="label">목표</p>
        <div className="seg">
          {GOAL_ORDER.map((g) => (
            <button key={g} className={profile.goal === g ? "on" : ""} onClick={() => set({ goal: g })}>{GOALS[g].label}</button>
          ))}
        </div>
        <p className="muted small">{GOALS[profile.goal].label}: {GOALS[profile.goal].desc}, 단백질 체중 1kg당 {GOALS[profile.goal].proteinPerKg}g</p>
      </section>

      {bodyForm && <BodyForm record={bodyForm} onClose={() => setBodyForm(null)} />}
    </>
  );
}

/** 목표 칼로리의 탄수화물·단백질·지방 비율 막대 */
function MacroBar({ n }: { n: Nutrients }) {
  const kc = [n.carb * 4, n.protein * 4, n.fat * 9];
  const sum = kc.reduce((a, b) => a + b, 0) || 1;
  const pct = (v: number) => Math.round((v / sum) * 100);
  return (
    <div className="macro-bar" role="img" aria-label={`탄수화물 ${pct(kc[0])}%, 단백질 ${pct(kc[1])}%, 지방 ${pct(kc[2])}%`}>
      <span className="carb" style={{ flexGrow: kc[0] }} />
      <span className="protein" style={{ flexGrow: kc[1] }} />
      <span className="fat" style={{ flexGrow: kc[2] }} />
    </div>
  );
}

type Metric = "weight" | "bodyFat" | "muscle";
/** 목표에 맞는 쪽으로 변했으면 good, 반대면 bad, 작은 변화나 유지 목표는 색 없이 */
function judge(m: Metric, diff: number, goal: Goal): "good" | "bad" | "" {
  const small = { weight: 0.2, bodyFat: 0.3, muscle: 0.2 }[m];
  if (Math.abs(diff) < small || goal === "maintain") return "";
  const up = diff > 0;
  if (m === "bodyFat") return up ? "bad" : "good";
  if (m === "muscle") return up ? "good" : "bad";
  return goal === "cut" ? (up ? "bad" : "good") : up ? "good" : "bad";
}

/** 최신 체중·체지방률·골격근과, 2주 넘게 지난 기록(없으면 첫 기록)과의 차이 */
function BodyStats({ latest, records, goal }: { latest: BodyRecord; records: BodyRecord[]; goal: Goal }) {
  const limit = addDays(latest.date, -14);
  const older = records.filter((r) => r.date < latest.date);
  const base = [...older].reverse().find((r) => r.date <= limit) ?? older[0];
  const cell = (m: Metric, label: string, unit: string, tone: string, diffUnit = unit) => {
    const v = latest[m];
    const b = base?.[m];
    const diff = v != null && b != null ? Math.round((v - b) * 10) / 10 : null;
    return (
      <div className={`body-stat ${tone}`}>
        <span className="muted small">{label}</span>
        <b>{v ?? "—"}<small>{v != null ? unit : ""}</small></b>
        <span className={`body-diff ${diff != null ? judge(m, diff, goal) : ""}`}>
          {diff == null ? "\u00a0" : diff === 0 ? "그대로" : `${diff > 0 ? "+" : ""}${diff}${diffUnit}`}
        </span>
      </div>
    );
  };
  const md = (d: string) => d.slice(5).split("-").map(Number).join("/");
  const days = base ? Math.round((+new Date(latest.date) - +new Date(base.date)) / 86400000) : 0;
  return (
    <>
      <div className="body-stats">
        {cell("weight", "체중", "kg", "protein")}
        {cell("bodyFat", "체지방률", "%", "fat", "%p")}
        {cell("muscle", "골격근", "kg", "carb")}
      </div>
      <p className="muted small body-compare">
        {md(latest.date)}{latest.source === "inbody" ? " 인바디" : ""}
        {base ? ` · ${days}일 전(${md(base.date)})과 비교` : ""}
      </p>
    </>
  );
}

/** 탄단지를 고치면 칼로리 자동 계산, 칼로리는 직접 고칠 수도 있음 */
function MacroEditor({ n, onChange }: { n: Nutrients; onChange: (n: Nutrients) => void }) {
  const update = (patch: Partial<Nutrients>) => {
    const next = { ...n, ...patch };
    onChange({ ...next, kcal: kcalFromMacros(next.carb, next.protein, next.fat) });
  };
  const field = (key: "carb" | "protein" | "fat", label: string) => (
    <label className="nfield">
      <span>{label} (g)</span>
      <NumInput value={n[key]} onChange={(v) => update({ [key]: v ?? 0 })} />
    </label>
  );
  return (
    <>
      <div className="ngrid three">
        <label className="nfield">
          <span>칼로리</span>
          <NumInput value={n.kcal} onChange={(v) => onChange({ ...n, kcal: v ?? 0 })} step="1" />
        </label>
        {field("carb", "탄수화물")}
        {field("protein", "단백질")}
        {field("fat", "지방")}
        <label className="nfield">
          <span>나트륨 상한 (mg)</span>
          <NumInput value={n.sodium ?? SODIUM_LIMIT} onChange={(v) => onChange({ ...n, sodium: v ?? 0 })} step="1" />
        </label>
      </div>
    </>
  );
}

function InBodyButton({ onRead }: { onRead: (r: BodyRecord) => void }) {
  const settings = useSettings();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const res = await readInBody(settings, await imageToBase64(file));
      if (!res.weight) throw new GeminiError("결과지에서 체중을 읽지 못했어요. 사진을 다시 찍거나 직접 입력해 주세요.");
      onRead({
        date: res.date && /^\d{4}-\d{2}-\d{2}$/.test(res.date) ? res.date : todayStr(),
        weight: res.weight,
        bodyFat: res.bodyFat ?? undefined,
        muscle: res.muscle ?? undefined,
        bmr: res.bmr ?? undefined,
        source: "inbody",
      });
    } catch (e) {
      alert(e instanceof GeminiError ? e.message : "인바디 사진을 읽지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        disabled={busy}
        onClick={() => (settings.geminiKey ? input.current?.click() : alert("인바디 사진을 읽으려면 설정에서 Gemini API 키를 입력해 주세요."))}
      >
        {busy ? "읽는 중..." : "인바디 사진"}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </>
  );
}

function BodyForm({ record, onClose }: { record: BodyRecord; onClose: () => void }) {
  const [r, setR] = useState<BodyRecord>(record);
  const profile = useProfile();
  const { target, calc } = useTargets();
  const [tip, setTip] = useState<AdjustSuggestion | null>(null);
  const save = async () => {
    if (!r.weight) return;
    // put이 새 기록에 id를 채워 넣어서(값을 안 고쳤으면 record와 같은 객체) 저장 전에 새 기록인지 확인
    const isNew = !record.id;
    await db.body.put(r);
    // 새 기록이면 2주 이상 전 기록과 비교해서 칼로리 조정 제안
    const next = profile && isNew ? suggestAdjust(profile.goal, r, await db.body.toArray(), profile.kcalAdjust) : null;
    // 컷팅 중 기초대사량 아래로 내려가는 제안은 하지 않음
    const floor = next && next.delta < 0 && !profile?.override && calc && target && target.kcal + next.delta < calc.bmr;
    if (next?.delta && target && !floor) return setTip(next);
    // 제안이 없을 때도 왜 없는지 알려 줌
    if (next) flash(floor ? `${next.text}. 더 줄이면 기초대사량보다 낮아져서 그대로 둘게요` : next.text, 4000);
    onClose();
  };
  if (tip && profile && target) {
    const cut = tip.delta < 0;
    // 바뀌는 탄수화물·지방 (직접 정한 목표는 탄수화물만, 계산값은 지방이 칼로리의 25%라 같이 조금 바뀜)
    const before = calcTargets(profile, r)?.target;
    const after = calcTargets({ ...profile, kcalAdjust: (profile.kcalAdjust ?? 0) + tip.delta }, r)?.target;
    const dFat = profile.override || !before || !after ? 0 : after.fat - before.fat;
    const dCarb = profile.override || !before || !after ? Math.round(tip.delta / 4) : after.carb - before.carb;
    const g = (v: number) => `${v > 0 ? "+" : ""}${v}g`;
    const accept = async () => {
      // 목표를 직접 정한 경우엔 그 값에서 탄수화물로 조정, 아니면 계산값에 더함
      if (profile.override) {
        const o = profile.override;
        await setKV("profile", { ...profile, override: { ...o, kcal: o.kcal + tip.delta, carb: Math.max(0, o.carb + tip.delta / 4) } });
      } else {
        await setKV("profile", { ...profile, kcalAdjust: (profile.kcalAdjust ?? 0) + tip.delta });
      }
      onClose();
    };
    return (
      <Dialog
        title="목표 칼로리 조정"
        actions={
          <>
            <button onClick={onClose}>그대로</button>
            <button className="primary" onClick={accept}>{cut ? "줄이기" : "늘리기"}</button>
          </>
        }
      >
        <div className="form">
          <p>{tip.text}.</p>
          <p className="muted small">
            {GOALS[profile.goal].label} 중인데 변화가 더뎌요. 하루 목표를 {Math.abs(tip.delta)}kcal {cut ? "줄여" : "늘려"} 볼까요?
          </p>
          <p className="adjust-preview">
            <span className="muted">{target.kcal.toLocaleString()}</span> → <b>{(target.kcal + tip.delta).toLocaleString()} kcal</b>
          </p>
          <p className="muted small">탄수화물 {g(dCarb)}{dFat ? ` · 지방 ${g(dFat)}` : ""} · 단백질은 그대로예요.</p>
        </div>
      </Dialog>
    );
  }
  const remove = async () => {
    if (r.id && confirm("이 기록을 삭제할까요?")) {
      await db.body.delete(r.id);
      onClose();
    }
  };
  return (
    <Sheet
      title={r.source === "inbody" ? "인바디 결과 확인" : "체중 기록"}
      onClose={onClose}
      footer={
        <>
          {r.id && <button className="danger" onClick={remove}>삭제</button>}
          <span className="spacer" />
          <button onClick={onClose}>취소</button>
          <button className="primary" onClick={save} disabled={!r.weight}>저장</button>
        </>
      }
    >
      <div className="form">
        {r.source === "inbody" && !r.id && <p className="muted small">AI가 읽은 값이에요. 결과지와 다르면 고쳐 주세요.</p>}
        <label>날짜<input type="date" value={r.date} onChange={(e) => setR({ ...r, date: e.target.value })} /></label>
        <label>체중 (kg)<NumInput value={r.weight || null} onChange={(v) => setR({ ...r, weight: v ?? 0 })} /></label>
        <div className="two">
          <label>체지방률 (%) <span className="muted">선택</span><NumInput value={r.bodyFat} onChange={(v) => setR({ ...r, bodyFat: v ?? undefined })} /></label>
          <label>골격근량 (kg) <span className="muted">선택</span><NumInput value={r.muscle} onChange={(v) => setR({ ...r, muscle: v ?? undefined })} /></label>
        </div>
        <label>기초대사량 (kcal) <span className="muted">선택</span><NumInput value={r.bmr} onChange={(v) => setR({ ...r, bmr: v ?? undefined })} /></label>
      </div>
    </Sheet>
  );
}
