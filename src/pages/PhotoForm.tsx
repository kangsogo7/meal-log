// 사진으로: 음식 사진(추정) 또는 영양성분표 사진(그대로 읽기) → 음식별로 양을 고쳐서 담기
// 분석은 뒤에서 돌아서 다른 앱을 써도 되고, 결과는 저장돼서 창을 다시 열어도 남아 있음
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getKV, setKV } from "../db";
import { analyzeFoodPhoto, GeminiError, imageToBase64, type PhotoResult } from "../gemini";
import { runInBackground, useJob } from "../bgJobs";
import { useSettings } from "../hooks";
import { NutrientLine } from "../components/ui";
import { AmountEditor, makePortion, portionGrams, portionNutrients, type Portion } from "../portion";
import type { Draft } from "./AddSheet";

const KEY = "photoAi";
interface Saved { at: number; preview: string; result: PhotoResult; place?: string; menu?: string }
interface Row { on: boolean; name: string; portion: Portion }

export default function PhotoForm({ onSave }: { onSave: (drafts: Draft[]) => void }) {
  const settings = useSettings();
  const job = useJob(KEY);
  const saved = useLiveQuery(() => getKV<Saved | null>(KEY, null), [], null);
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [memo, setMemo] = useState("");
  const [place, setPlace] = useState("");
  const [menu, setMenu] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  // 새 결과가 오면 음식별 줄을 만듦 (모두 담기로 선택)
  useEffect(() => {
    if (!saved) return setRows([]);
    setRows(saved.result.items.map((i) => ({ on: true, name: i.name, portion: makePortion(i.nutrients, i.grams, 1, i.amount) })));
  }, [saved?.at]);

  const pick = async (file: File) => {
    setPhoto({ file, url: URL.createObjectURL(file) });
    await setKV(KEY, null); // 새 사진이면 이전 결과는 지움
  };

  const analyze = () => {
    if (!photo) return;
    const file = photo.file;
    const info = { place: place.trim(), menu: menu.trim(), memo: memo.trim() };
    runInBackground(
      KEY,
      async () => {
        const [image, small] = await Promise.all([imageToBase64(file, 1280), imageToBase64(file, 320)]);
        const result = await analyzeFoodPhoto(settings, image, info);
        await setKV(KEY, { at: Date.now(), preview: `data:${small.mimeType};base64,${small.data}`, result, place: info.place, menu: info.menu } satisfies Saved);
      },
      { done: "사진 분석이 끝났어요", fail: (e) => (e instanceof GeminiError ? e.message : "사진을 분석하지 못했어요.") },
    );
  };

  const reset = async () => {
    setPhoto(null);
    setMemo("");
    setPlace("");
    setMenu("");
    await setKV(KEY, null);
  };

  const chosen = rows.filter((r) => r.on && r.name.trim());
  const save = async () => {
    const shop = saved?.place?.trim() || undefined;
    const kind = shop ? "out" : saved?.result.type === "label" ? "food" : "manual";
    onSave(
      chosen.map((r) => {
        const g = portionGrams(r.portion);
        return {
          kind,
          place: shop,
          title: r.name.trim(),
          items: [{ name: r.name.trim(), amountText: g ? `${g}g` : "", grams: g, source: "ai" as const, nutrients: portionNutrients(r.portion) }],
          k: r.portion.k,
        };
      }),
    );
    await reset();
  };

  if (!settings.geminiKey) return <p className="muted small">사진으로 분석하려면 설정에서 Gemini API 키를 먼저 입력해 주세요.</p>;

  const filePicker = (
    <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
  );

  // ---- 결과: 음식별로 양 고치고 담기 ----
  if (saved) {
    return (
      <div className="form photo-form">
        <div className="photo-head">
          <img src={saved.preview} alt="분석한 사진" />
          <div>
            <b>{saved.result.type === "label" ? "영양성분표를 읽었어요" : `음식 ${rows.length}개를 찾았어요`}</b>
            <p className="muted small">{saved.result.type === "label" ? "표의 숫자 그대로예요." : "양은 사진으로 눈대중한 값이라 실제와 다를 수 있어요. 고쳐서 담아 주세요."}</p>
            {saved.result.note && <p className="muted small">{saved.result.note}</p>}
          </div>
        </div>
        <ul className="photo-rows">
          {rows.map((r, i) => {
            const set = (patch: Partial<Row>) => setRows((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <li key={i} className={r.on ? "" : "off"}>
                <label className="photo-row-head">
                  <input type="checkbox" checked={r.on} onChange={(e) => set({ on: e.target.checked })} />
                  <input className="photo-name" value={r.name} onChange={(e) => set({ name: e.target.value })} aria-label="음식 이름" />
                </label>
                {r.on && (
                  <>
                    <AmountEditor portion={r.portion} onChange={(portion) => set({ portion })} />
                    <NutrientLine n={portionNutrients(r.portion)} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <div className="set-actions">
          <button onClick={() => input.current?.click()}>다른 사진</button>
          <button className="primary" onClick={save} disabled={!chosen.length}>{chosen.length}개 담기</button>
        </div>
        {filePicker}
      </div>
    );
  }

  // ---- 사진 고르기 → 분석 ----
  return (
    <div className="form photo-form">
      {photo ? (
        <button className="photo-preview" onClick={() => input.current?.click()} aria-label="사진 바꾸기">
          <img src={photo.url} alt="고른 사진" />
        </button>
      ) : (
        <button className="photo-pick" onClick={() => input.current?.click()}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          <b>사진 찍기 · 고르기</b>
          <span className="muted small">음식 사진 또는 포장지의 영양성분표</span>
        </button>
      )}
      <div className="two">
        <label>가게 이름 <span className="muted">선택</span>
          <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="예: 샐러디" />
        </label>
        <label>메뉴명 <span className="muted">선택</span>
          <input value={menu} onChange={(e) => setMenu(e.target.value)} placeholder="예: 우삼겹 웜볼" />
        </label>
      </div>
      {(place.trim() || menu.trim()) && <p className="muted small">가게·메뉴의 공식 정보를 찾아 참고해서 조금 더 걸려요.</p>}
      <label>메모 <span className="muted">선택</span>
        <textarea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={"예: 밥은 반만 먹음\n드레싱은 따로 절반만"} />
      </label>
      {job.error && <p className="error">{job.error}</p>}
      <button className="primary block big" onClick={analyze} disabled={!photo || job.running}>
        {job.running ? "분석하는 중... (다른 앱을 써도 돼요)" : "분석하기"}
      </button>
      {filePicker}
    </div>
  );
}
