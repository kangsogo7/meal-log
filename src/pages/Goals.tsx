import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, setKV, todayStr, type BodyRecord, type ExerciseKind, type Nutrients, type Profile } from "../db";
import { ACTIVITY, EXERCISES, GOAL_ORDER, GOALS, kcalFromMacros, SODIUM_LIMIT } from "../nutrition";
import { useLatestBody, useProfile, useProfileSaved, useSettings, useTargets } from "../hooks";
import { GeminiError, imageToBase64, readInBody } from "../gemini";
import { NumInput, Sheet } from "../components/ui";
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
        <h2>하루 목표 영양성분</h2>
        {target ? (
          <>
            <div className="target-grid">
              <div><span className="muted small">칼로리</span><b>{target.kcal.toLocaleString()}</b><em>kcal</em></div>
              <div className="carb"><span className="muted small">탄수화물</span><b>{target.carb}</b><em>g</em></div>
              <div className="protein"><span className="muted small">단백질</span><b>{target.protein}</b><em>g</em></div>
              <div className="fat"><span className="muted small">지방</span><b>{target.fat}</b><em>g</em></div>
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
              <li>
                운동 소모량 일주일 {calc.exerciseDetail.map((e) => `${e.label} ${e.perWeek}`).join(" + ")} kcal
                → 하루 평균 <b>{calc.exerciseKcal} kcal</b>
              </li>
              <li>기초대사량 × 평소 활동량 + 운동 = 하루 소모량 <b>{calc.tdee} kcal</b></li>
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
        {latest ? (
          <p className="body-latest">
            <b>{latest.weight}kg</b>
            {latest.bodyFat ? ` · 체지방 ${latest.bodyFat}%` : ""}
            {latest.muscle ? ` · 골격근 ${latest.muscle}kg` : ""}
            <span className="muted small"> ({latest.date}{latest.source === "inbody" ? ", 인바디" : ""})</span>
          </p>
        ) : (
          <p className="muted small">아직 기록이 없어요.</p>
        )}
        <div className="btn-row">
          <button className="primary" onClick={() => setBodyForm({ date: todayStr(), weight: latest?.weight ?? 0, source: "manual" })}>체중 기록</button>
          <InBodyButton onRead={setBodyForm} />
        </div>
        <WeightChart points={records.map((r) => ({ date: r.date, weight: r.weight }))} />
        {records.length > 0 && (
          <details>
            <summary className="small">전체 기록 보기</summary>
            <ul className="mini-list">
              {[...records].reverse().map((r) => (
                <li key={r.id}>
                  <span>{r.date} · {r.weight}kg{r.bodyFat ? ` · ${r.bodyFat}%` : ""}{r.muscle ? ` · 근육 ${r.muscle}kg` : ""}</span>
                  <button className="ghost small" onClick={() => setBodyForm(r)}>수정</button>
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

/** 탄단지만 입력하면 칼로리는 자동 계산 */
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
        {field("carb", "탄수화물")}
        {field("protein", "단백질")}
        {field("fat", "지방")}
        <label className="nfield">
          <span>나트륨 상한 (mg)</span>
          <NumInput value={n.sodium ?? SODIUM_LIMIT} onChange={(v) => onChange({ ...n, sodium: v ?? 0 })} step="1" />
        </label>
      </div>
      <p className="muted small">칼로리 <b>{kcalFromMacros(n.carb, n.protein, n.fat).toLocaleString()} kcal</b> (자동 계산)</p>
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
  const save = async () => {
    if (!r.weight) return;
    await db.body.put(r);
    onClose();
  };
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
