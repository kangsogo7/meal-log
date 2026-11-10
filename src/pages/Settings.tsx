import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, setKV } from "../db";
import { FolderScreen, FoodEditScreen } from "./FavoritesTab";
import { exportBackup, importBackup } from "../backup";
import { cleanKey, GEMINI_MODELS as MODELS, GeminiError, looksLikeKey, testGemini } from "../gemini";
import { useSettings } from "../hooks";
import { getTheme, setTheme, type Theme } from "../theme";
import { Btn, BtnRow, FullScreen, TextInput } from "../components/ui";

const THEMES: { key: Theme; label: string }[] = [
  { key: "system", label: "시스템" },
  { key: "light", label: "라이트" },
  { key: "dark", label: "다크" },
];

export default function SettingsPage() {
  const settings = useSettings();
  // 즐겨찾기 폴더 관리 → 폴더를 누르면 그 폴더 음식 편집
  const [folders, setFolders] = useState(false);
  const [folderId, setFolderId] = useState<number | null>(null);
  const folderGroup = useLiveQuery(() => (folderId == null ? undefined : db.groups.get(folderId)), [folderId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme());

  const [keyOpen, setKeyOpen] = useState(false);

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

      <section className="card">
        <h2>즐겨찾기</h2>
        <div className="btn-row">
          <button onClick={() => setFolders(true)}>폴더 관리</button>
        </div>
      </section>
      {folders && <FolderScreen onClose={() => setFolders(false)} onOpen={(id) => setFolderId(id)} />}
      {folderGroup && <FoodEditScreen group={folderGroup} onClose={() => setFolderId(null)} />}

      <section className="card">
        <button className="setting-row" onClick={() => setKeyOpen(true)}>
          <span className="fr-text">
            <span className="fr-title">AI 기능 (Gemini API 키)</span>
            <span className="fr-sub">{settings.geminiKey ? "연결됨 · 사진 기록과 AI 검색을 쓸 수 있어요" : "키를 넣으면 사진으로 기록할 수 있어요"}</span>
          </span>
          <span className="fr-chev" aria-hidden>›</span>
        </button>
      </section>
      {keyOpen && <GeminiKeyScreen onClose={() => setKeyOpen(false)} />}

      <section className="card form">
        <h2>백업</h2>
        <div className="btn-row">
          <button onClick={exportBackup}>백업 파일 저장</button>
          <button onClick={() => fileRef.current?.click()}>백업 불러오기</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importBackup(f); }} />
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

/** 제미나이 API 키 넣기: 맨 위에 입력칸, 아래에 키 만드는 방법 */
function GeminiKeyScreen({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const [keyInput, setKeyInput] = useState<string | null>(null);
  const [status, setStatus] = useState("");
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

  return (
    <FullScreen title="AI 기능 켜기" onClose={onClose}>
      <div className="form key-screen">
        <section className="key-box">
          <label>Gemini API 키
            <TextInput type="password" autoComplete="off" value={key} onChange={setKeyInput} placeholder="여기에 붙여넣기" />
          </label>
          {keyWarning && <p className="error">{keyWarning}</p>}
          <BtnRow>
            <Btn onClick={saveKey} disabled={!key.trim()}>저장만</Btn>
            <Btn kind="primary" onClick={test} disabled={!key.trim()}>연결 확인하고 저장</Btn>
          </BtnRow>
          {status && <p className="small">{status}</p>}
        </section>

        <section className="key-box">
          <b>키를 넣으면</b>
          <span className="muted small">음식 사진으로 기록 · 메뉴 이름으로 영양정보 찾기 · 주간 평가 한마디를 쓸 수 있어요. 키는 이 폰에만 저장돼요.</span>
        </section>

        <ol className="key-steps">
          <li><b>구글 AI Studio 열기</b><span className="muted small">아래 버튼을 눌러 구글 계정으로 로그인해요.</span></li>
          <li><b>API 키 만들기</b><span className="muted small">AI Studio의 API 키 화면에서 새 키를 만들어요.</span></li>
          <li><b>키 복사</b><span className="muted small">만든 키 전체를 복사해요. "AQ." 또는 "AIza"로 시작해요.</span></li>
          <li><b>맨 위 칸에 붙여넣기</b><span className="muted small">붙여넣고 "연결 확인하고 저장"을 눌러요.</span></li>
        </ol>
        <a className="btn secondary key-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">구글 AI Studio 열기 ↗</a>

        <label>모델
          <select value={settings.geminiModel} onChange={(e) => setKV("settings", { ...settings, geminiModel: e.target.value })}>
            {[...new Set([settings.geminiModel, ...MODELS])].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>
    </FullScreen>
  );
}
