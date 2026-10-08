// 식단 화면 아래: 주간 평가 (월~일)
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, getKV, MEALS, setKV } from "../db";
import { useProfile, useSettings, useTargetsFor } from "../hooks";
import { GOALS, GRADE_EMOJI } from "../nutrition";
import { WeekChart } from "../components/charts";
import { GeminiError, weeklyComment } from "../gemini";
import { runInBackground, useJob } from "../bgJobs";
import { CRITERIA, CRITERIA_ORDER, evaluateDay, evaluateWeek, weekDays, weekLabel, weekStartOf, type WeekResult } from "../weekly";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];

export default function WeeklyCard({ date, onSelect: select }: { date: string; onSelect: (d: string) => void }) {
  // 여기서 날짜를 고르면 그날 기록을 보도록 화면 맨 위로
  const onSelect = (d: string) => {
    select(d);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [start, setStart] = useState(() => weekStartOf(date));
  // 위에서 날짜를 바꾸면 그 날짜가 있는 주로
  useEffect(() => setStart(weekStartOf(date)), [date]);
  const days = weekDays(start);
  const end = days[6];
  const entries = useLiveQuery(() => db.entries.where("date").between(start, end, true, true).toArray(), [start, end], []);
  const targets = useTargetsFor(days);
  const profile = useProfile();

  const week = evaluateWeek(days.map((d) => evaluateDay(d, entries.filter((e) => e.date === d), targets[d])));
  const goals = days.map((d) => targets[d]?.kcal).filter((v): v is number => !!v);
  const goalKcal = goals.length ? Math.round(goals.reduce((a, b) => a + b, 0) / goals.length) : null;

  return (
    <section className="card weekly">
      <div className="weekly-head">
        <h2>주간 평가</h2>
        <div className="week-nav">
          <button className="ghost" onClick={() => setStart(addDays(start, -7))} aria-label="지난주">◀</button>
          <span>{weekLabel(start)}</span>
          <button className="ghost" onClick={() => setStart(addDays(start, 7))} aria-label="다음 주">▶</button>
        </div>
      </div>

      {week.score != null ? (
        <div className="week-score">
          <span className="emoji">{GRADE_EMOJI[week.grade!]}</span>
          <b>{week.score}점</b>
          <span className="muted small">기록한 {week.scored.length}일 평균</span>
        </div>
      ) : (
        <p className="muted small">아직 평가할 날이 없어요. 하루가 끝난 날부터 점수를 매겨요.</p>
      )}

      <div className="week-days">
        {week.days.map((d, i) => (
          <button key={d.date} className={`wd ${d.date === date ? "sel" : ""}`} onClick={() => onSelect(d.date)}>
            <span className="muted">{DOW[i]}</span>
            <span className={`wd-mark ${d.status === "today" ? "txt" : ""}`}>
              {d.status === "scored" ? GRADE_EMOJI[d.grade!] : d.status === "today" ? "오늘" : d.status === "none" ? "–" : ""}
            </span>
            <span className="wd-score">{d.status === "scored" ? d.score : ""}</span>
          </button>
        ))}
      </div>

      <WeekChart days={days} values={week.days.map((d) => Math.round(d.total.kcal))} goal={goalKcal} selected={date} onSelect={onSelect} label="이번 주 섭취 칼로리" />

      {week.scored.length > 0 && (
        <>
          <ul className="week-sum">
            {CRITERIA_ORDER.map((c) => {
              const s = week.summary[c];
              const unit = c === "kcal" ? "kcal" : c === "sodium" ? "mg" : "g";
              return (
                <li key={c}>
                  <span>{CRITERIA[c].label}</span>
                  <span className="muted">평균 <b>{s.avg.toLocaleString()}</b> / {s.target.toLocaleString()}{unit}</span>
                  <span className="wk-good">{s.good}/{week.scored.length}일</span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">잘 지킨 날: 칼로리 ±10%, 단백질 90% 이상, 탄수화물·지방 ±20%, 나트륨 상한 이하</p>
          <AiComment start={start} week={week} goalLabel={profile ? GOALS[profile.goal].label : "유지"} entries={entries} />
        </>
      )}
    </section>
  );
}

/** Gemini 한줄평. 버튼을 눌렀을 때만 부르고, 기록이 그대로면 저장해 둔 평을 다시 보여 줌 */
function AiComment({ start, week, goalLabel, entries }: { start: string; week: WeekResult; goalLabel: string; entries: { date: string; meal: string; title: string; place?: string }[] }) {
  const settings = useSettings();
  const key = `weekAi:${start}`;
  const report = week.scored
    .map((d) => {
      const t = d.target!;
      const foods = entries
        .filter((e) => e.date === d.date)
        .map((e) => `${MEALS.find((m) => m.key === e.meal)?.label ?? ""} ${e.place ? e.place + " " : ""}${e.title}`)
        .join(", ");
      const dow = DOW[week.days.findIndex((x) => x.date === d.date)];
      return `${dow}(${d.date}) ${d.score}점: 칼로리 ${Math.round(d.total.kcal)}/${t.kcal}kcal, 단백질 ${Math.round(d.total.protein)}/${t.protein}g, 탄수화물 ${Math.round(d.total.carb)}/${t.carb}g, 지방 ${Math.round(d.total.fat)}/${t.fat}g, 나트륨 ${Math.round(d.total.sodium ?? 0)}/${t.sodium ?? 2000}mg | ${foods}`;
    })
    .join("\n");
  const saved = useLiveQuery(() => getKV<{ sig: string; text: string } | null>(key, null), [key]);
  // 요청은 뒤에서 진행 (다른 화면으로 가도 계속되고, 끝나면 알림)
  const { running: busy, error } = useJob(key);
  const fresh = saved && saved.sig === report ? saved.text : null;

  if (!settings.geminiKey) return null;
  const run = () =>
    runInBackground(
      key,
      async () => {
        const text = await weeklyComment(settings, goalLabel, report);
        await setKV(key, { sig: report, text });
      },
      { done: "AI 한줄평이 도착했어요", fail: (e) => (e instanceof GeminiError ? e.message : "AI 한줄평을 받지 못했어요.") },
    );

  return (
    <div className="ai-comment">
      {fresh ? <p>{fresh}</p> : saved?.text && <p className="muted">{saved.text}</p>}
      {error && <p className="error small">{error}</p>}
      {!fresh && (
        <button className="block" onClick={run} disabled={busy}>
          {busy ? "AI가 보는 중... (다른 화면을 써도 돼요)" : saved?.text ? "기록이 바뀌었어요 · AI 한줄평 다시 받기" : "AI 한줄평 받기"}
        </button>
      )}
      {saved?.text && <WeekMemo start={start} />}
    </div>
  );
}

/** 한줄평에 남기는 내 메모 (주마다 하나, 입력하면 바로 저장) */
function WeekMemo({ start }: { start: string }) {
  const key = `weekMemo:${start}`;
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setText(null);
    getKV<unknown>(key, "").then((v) => alive && setText(typeof v === "string" ? v : ""));
    return () => { alive = false; };
  }, [key]);
  useEffect(() => {
    if (text == null) return;
    const t = setTimeout(() => setKV(key, text), 400);
    return () => clearTimeout(t);
  }, [key, text]);
  if (text == null) return null;
  return (
    <label className="week-memo-label">
      코멘트
      <textarea
        className="week-memo"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="AI 한줄평에 대한 내 한줄평"
      />
    </label>
  );
}
