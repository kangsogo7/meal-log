import { useRef, useState } from "react";
import { db, setKV } from "../db";
import { cleanKey, GEMINI_MODELS as MODELS, GeminiError, testGemini } from "../gemini";
import { useSettings } from "../hooks";

export default function SettingsPage() {
  const settings = useSettings();
  const [keyInput, setKeyInput] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const key = keyInput ?? settings.geminiKey;
  const cleaned = cleanKey(key);
  // Gemini 키는 보통 "AIza"로 시작하는 39자
  const keyWarning = cleaned && !/^AIza[A-Za-z0-9_-]{35}$/.test(cleaned)
    ? `키 모양이 이상해요 (${cleaned.length}자). AI Studio에서 키 전체를 다시 복사해 주세요.`
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
      await db.transaction("rw", [db.entries, db.body, db.saved, db.kv], async () => {
        await Promise.all([db.entries.clear(), db.body.clear(), db.saved.clear()]);
        await db.entries.bulkAdd(data.entries);
        await db.body.bulkAdd(data.body ?? []);
        await db.saved.bulkPut(data.saved ?? []);
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

      <section className="card form">
        <h2>Gemini API 키</h2>
        <p className="muted small">
          외식 메뉴 추정, 식재료 양 계산, 인바디 사진 읽기에 써요. 키가 없어도 식약처 DB 검색과 직접 입력은 할 수 있어요.
        </p>
        <ol className="small steps">
          <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>에 구글 계정으로 로그인</li>
          <li>"API 키 만들기"를 눌러 키 복사</li>
          <li>아래에 붙여넣고 "연결 확인"</li>
        </ol>
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKeyInput(e.target.value)} placeholder="AIza..." />
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
        <p className="muted small">무료 사용 한도에 자주 걸리면 "lite" 모델로 바꿔 보세요. 무료 등급에서는 입력한 내용이 구글 서비스 개선에 쓰일 수 있어요.</p>
      </section>

      <section className="card form">
        <h2>백업</h2>
        <p className="muted small">기록은 이 휴대폰에만 저장돼요. 휴대폰을 바꾸거나 앱을 지우기 전에 백업 파일을 저장해 두세요. (API 키는 백업에 들어가지 않아요)</p>
        <div className="btn-row">
          <button onClick={exportData}>백업 파일 저장</button>
          <button onClick={() => fileRef.current?.click()}>백업 불러오기</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importData(f); }} />
      </section>

      <section className="card">
        <h2>홈 화면에 앱 설치</h2>
        <ul className="small steps">
          <li><b>아이폰</b>: Safari로 열고 → 아래 공유 버튼(□↑) → "홈 화면에 추가"</li>
          <li><b>안드로이드</b>: Chrome으로 열고 → 오른쪽 위 ⋮ → "홈 화면에 추가" 또는 "앱 설치"</li>
        </ul>
      </section>

      <section className="card">
        <h2>데이터 출처</h2>
        <p className="muted small">
          식품의약품안전처 전국통합식품영양성분정보 표준데이터(원재료성식품, 음식, 가공식품) — 공공데이터포털.
          AI 추정값은 실제와 다를 수 있어요.
        </p>
      </section>
      <p className="muted small version">앱 버전 {__APP_VERSION__}</p>
    </>
  );
}
