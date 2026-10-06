// 활동: 건강 앱에서 가져온 걸음 수·활동 칼로리·운동 기록
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, todayStr, type DayActivity } from "../db";
import { DateNav, flash } from "../components/ui";
import { WeekChart } from "../components/charts";
import { HealthError, healthMode, importShortcutText, openHealthSettings, syncFromHealth } from "../health";

export const APK_URL = "https://github.com/kangsogo7/meal-log/releases/download/android/meal-log.apk";
const AUTO_SYNC_MS = 30 * 60 * 1000;

const timeOf = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const agoText = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

export default function Activity() {
  const [date, setDate] = useState(todayStr());
  const mode = healthMode();
  const weekStart = addDays(date, -6);
  const week = useLiveQuery(() => db.activity.where("date").between(weekStart, date, true, true).toArray(), [weekStart, date], []);
  const last = useLiveQuery(() => db.activity.orderBy("date").last(), []);
  const day: DayActivity | undefined = week.find((d) => d.date === date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDate = (d: string) => week.find((w) => w.date === d);
  const workoutMin = day?.workouts.reduce((s, w) => s + w.minutes, 0) ?? 0;

  return (
    <>
      <DateNav date={date} onChange={setDate} />

      <section className="card">
        <div className="stat-grid">
          <Stat label="걸음" value={day?.steps} unit="보" />
          <Stat label="활동 칼로리" value={day?.activeKcal} unit="kcal" />
          <Stat label="운동" value={day ? workoutMin : undefined} unit="분" />
        </div>
      </section>

      <section className="card">
        <h2>운동 기록</h2>
        {day?.workouts.length ? (
          <ul className="workout-list">
            {day.workouts.map((w, i) => (
              <li key={i}>
                <div>
                  <b>{w.type}</b>
                  {w.start && <span className="muted small"> {timeOf(w.start)}</span>}
                </div>
                <span className="muted">{w.minutes}분{w.kcal ? ` · ${w.kcal}kcal` : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{day ? "운동 기록이 없어요" : "이 날짜의 건강 데이터가 없어요"}</p>
        )}
      </section>

      <section className="card">
        <h2>최근 7일 걸음</h2>
        <WeekChart days={days} values={days.map((d) => byDate(d)?.steps ?? 0)} goal={null} selected={date} onSelect={setDate} label="최근 7일 걸음 수" unit="보" />
      </section>
      <section className="card">
        <h2>최근 7일 활동 칼로리</h2>
        <WeekChart days={days} values={days.map((d) => byDate(d)?.activeKcal ?? 0)} goal={null} selected={date} onSelect={setDate} label="최근 7일 활동 칼로리" />
      </section>

      <SyncCard mode={mode} lastSync={last?.syncedAt} />
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <b>{value != null ? value.toLocaleString() : "—"}</b>
      <em>{unit}</em>
    </div>
  );
}

function SyncCard({ mode, lastSync }: { mode: ReturnType<typeof healthMode>; lastSync?: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sync = async (quiet = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await syncFromHealth(14);
      if (!quiet) flash(`${r.days}일치 가져왔어요${r.workouts ? ` · 운동 ${r.workouts}개` : ""}`);
    } catch (e) {
      setError(e instanceof HealthError ? e.message : `가져오지 못했어요 (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      setBusy(false);
    }
  };

  // 앱에서는 화면을 열 때 30분이 지났으면 자동으로 가져옴
  useEffect(() => {
    if ((mode === "android-app" || mode === "ios-app") && (!lastSync || Date.now() - lastSync > AUTO_SYNC_MS)) sync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  if (mode === "android-app" || mode === "ios-app") {
    return (
      <section className="card">
        <div className="row-between">
          <h2>{mode === "android-app" ? "Health Connect" : "건강 앱"}</h2>
          {lastSync && <span className="muted small">{agoText(lastSync)} 가져옴</span>}
        </div>
        <button className="primary block" onClick={() => sync()} disabled={busy}>{busy ? "가져오는 중..." : "지금 가져오기"}</button>
        {error && <p className="error">{error}</p>}
        {mode === "android-app" && (
          <button className="link small settings-link" onClick={() => openHealthSettings().catch(() => {})}>Health Connect 권한 설정</button>
        )}
      </section>
    );
  }
  if (mode === "ios-web") return <ShortcutCard lastSync={lastSync} />;
  if (mode === "android-web") {
    return (
      <section className="card">
        <h2>건강 데이터 연동</h2>
        <p className="muted small">삼성헬스·Health Connect 데이터는 안드로이드 앱에서 가져올 수 있어요. 설치 후 설정 → 백업으로 기록을 옮겨 주세요.</p>
        <a className="btn-link primary" href={APK_URL}>안드로이드 앱 받기</a>
      </section>
    );
  }
  return (
    <section className="card">
      <p className="muted small">건강 데이터는 휴대폰에서 가져올 수 있어요.</p>
    </section>
  );
}

/** 아이폰 웹앱: 단축어를 실행해 복사한 글을 붙여넣기 */
function ShortcutCard({ lastSync }: { lastSync?: number }) {
  const [text, setText] = useState("");
  const [manual, setManual] = useState(false);
  const [error, setError] = useState("");

  const doImport = async (t: string) => {
    setError("");
    try {
      const r = await importShortcutText(t);
      flash(`${r.days}일치 가져왔어요`);
      setText("");
      setManual(false);
    } catch (e) {
      setError(e instanceof HealthError ? e.message : "가져오지 못했어요");
    }
  };

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) return doImport(t);
    } catch {
      // 클립보드 읽기를 막으면 직접 붙여넣기 칸으로
    }
    setManual(true);
  };

  return (
    <section className="card">
      <div className="row-between">
        <h2>건강 앱 (단축어)</h2>
        {lastSync && <span className="muted small">{agoText(lastSync)} 가져옴</span>}
      </div>
      <button className="primary block" onClick={paste}>단축어 데이터 붙여넣기</button>
      {manual && (
        <div className="form paste-box">
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="여기를 길게 눌러 붙여넣기" autoFocus />
          <button className="block" onClick={() => doImport(text)} disabled={!text.trim()}>가져오기</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <details className="shortcut-guide">
        <summary>단축어 만드는 방법</summary>
        <ol className="small steps">
          <li>단축어 앱 → <b>+</b> → 동작 <b>건강 샘플 찾기</b>: 유형 <b>걸음</b> · 시작일 <b>오늘임</b> · 그룹화 <b>일</b></li>
          <li>동작 <b>건강 샘플 찾기</b> 하나 더: 유형 <b>활동 에너지</b> · 시작일 <b>오늘임</b> · 그룹화 <b>일</b></li>
          <li>동작 <b>텍스트</b>: <code>걸음: </code> 쓰고 → 키보드 위 <b>변수 선택</b> → 1번 동작 결과 누르기. 줄을 바꿔 <code>활동칼로리: </code> 쓰고 → 2번 동작 결과 넣기</li>
          <li>동작 <b>클립보드에 복사</b></li>
        </ol>
        <p className="muted small">텍스트는 이렇게 보이면 돼요 (파란 칸이 변수). 날짜는 안 넣어도 오늘로 들어가요.</p>
        <pre className="shortcut-sample">{`걸음: [건강 샘플]
활동칼로리: [건강 샘플]`}</pre>
        <p className="muted small">단축어를 실행한 뒤 여기서 "단축어 데이터 붙여넣기"를 누르세요.</p>
      </details>
    </section>
  );
}
