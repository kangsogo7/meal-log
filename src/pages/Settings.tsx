import { useRef, useState } from "react";
import { db, setKV } from "../db";
import { cleanKey, GEMINI_MODELS as MODELS, GeminiError, looksLikeKey, testGemini } from "../gemini";
import { useSettings } from "../hooks";
import { getTheme, setTheme, type Theme } from "../theme";

const THEMES: { key: Theme; label: string }[] = [
  { key: "system", label: "시스템" },
  { key: "light", label: "라이트" },
  { key: "dark", label: "다크" },
];

export default function SettingsPage() {
  const settings = useSettings();
  const [keyInput, setKeyInput] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme());

  const key = keyInput ?? settings.geminiKey;
  const cleaned = cleanKey(key);
  const keyWarning = cleaned && !looksLikeKey(cleaned)
    ? `키 모양이 이상해요 (${cleaned.length}자). 키는 "AQ." 또는 "AIza"로 시작해요. AI Studio에서 키 전체를 다시 복사해 주세요.`
    : "";

  const saveKey = async () => {
    await setKV("settings", { ...settings, geminiKey: cleaned });
    setKeyInput(null);
    setStatus("저장했어요.");
  };

  const test = async () => {
    setStatus("확인 중...");
    try {
      await testGemini({ ...settings, geminiKey: cleaned });
      await setKV("settings", { ...settings, geminiKey: cleaned });
      setKeyInput(null);
      setStatus("✅ 연결됐어요. 저장했어요.");
    } catch (e) {
      setStatus(`❌ ${e instanceof GeminiError ? e.message : "연결에 실패했어요."}`);
    }
  };

  const exportData = async () => {
    const data = {
      app: "meal-log",
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: await db.entries.toArray(),
      body: await db.body.toArray(),
      saved: await db.saved.toArray(),
      sets: await db.sets.toArray(),
      // API 키는 백업 파일에 넣지 않음
      kv: (await db.kv.toArray()).filter((r) => r.key !== "settings"),
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `식단기록-백업-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "meal-log" || !Array.isArray(data.entries)) throw new Error();
      if (!confirm(`식단 ${data.entries.length}개, 체중 ${data.body?.length ?? 0}개를 가져올게요.\n지금 기록은 모두 바뀌어요. 계속할까요?`)) return;
      await db.transaction("rw", [db.entries, db.body, db.saved, db.sets, db.kv], async () => {
        await Promise.all([db.entries.clear(), db.body.clear(), db.saved.clear(), db.sets.clear()]);
        await db.entries.bulkAdd(data.entries);
        await db.body.bulkAdd(data.body ?? []);
        await db.saved.bulkPut(data.saved ?? []);
        await db.sets.bulkAdd(data.sets ?? []);
        await db.kv.bulkPut((data.kv ?? []).filter((r: { key: string }) => r.key !== "settings"));
      });
      alert("가져왔어요.");
    } catch {
      alert("올바른 백업 파일이 아니에요.");
    }
  };

  return (
    <>
      <header className="page-head"><h1>설정</h1></header>

      <section className="card">
        <h2>화면 테마</h2>
        <div className="seg">
          {THEMES.map((t) => (
            <button key={t.key} className={theme === t.key ? "on" : ""} onClick={() => { setTheme(t.key); setThemeState(t.key); }}>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card form">
        <div className="row-between">
          <h2>Gemini API 키</h2>
          <a className="small ext-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">키 발급 ↗</a>
        </div>
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKeyInput(e.target.value)} placeholder="AQ.으로 시작하는 키" />
        <div className="btn-row">
          <button className="primary" onClick={test} disabled={!key.trim()}>연결 확인</button>
          <button onClick={saveKey}>저장만</button>
        </div>
        {keyWarning && <p className="error">{keyWarning}</p>}
        {status && <p className="small">{status}</p>}
        <label>모델
          <select value={settings.geminiModel} onChange={(e) => setKV("settings", { ...settings, geminiModel: e.target.value })}>
            {[...new Set([settings.geminiModel, ...MODELS])].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </section>

      <section className="card form">
        <h2>백업</h2>
        <div className="btn-row">
          <button onClick={exportData}>백업 파일 저장</button>
          <button onClick={() => fileRef.current?.click()}>백업 불러오기</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importData(f); }} />
      </section>

      <section className="card">
        <details>
          <summary>홈 화면에 앱 설치</summary>
          <ul className="small steps">
            <li>아이폰: Safari → 공유(□↑) → 홈 화면에 추가</li>
            <li>안드로이드: Chrome → ⋮ → 앱 설치</li>
          </ul>
        </details>
      </section>

      <p className="muted small version">
        영양 데이터: 식품의약품안전처 (공공데이터포털)<br />
        버전 {__APP_VERSION__}
      </p>
    </>
  );
}
