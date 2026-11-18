// 끼니 사진: 카메라(기본, 1:1로 찍기) · 사진앨범(앱 안 앨범 격자 + 영역 고르기).
// 건너뛰기 = 사진 없이 기록, 취소 = 닫기
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CropEditor, { type CropHandle } from "./CropEditor";
import { hasLibrary, libraryAccess, libraryFull, libraryList, libraryMore, type LibraryItem, type LibraryStatus } from "../photoLibrary";

const SIZE = 1080;
const PAGE = 40;

/** 카메라 화면의 가운데를 1:1로 잘라 JPEG로 */
function squareJpeg(src: CanvasImageSource, w: number, h: number, mirror = false): Promise<Blob> {
  const s = Math.min(w, h);
  const c = document.createElement("canvas");
  c.width = c.height = Math.min(SIZE, s);
  const g = c.getContext("2d")!;
  if (mirror) {
    g.translate(c.width, 0);
    g.scale(-1, 1);
  }
  g.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, c.width, c.height);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("사진을 만들지 못했어요"))), "image/jpeg", 0.85));
}

/** 사진앨범: 위에 영역 고르기, 아래에 최근 사진 격자 */
function Album({ crop, onReady, webFile, onPickWeb, tools }: { crop: React.RefObject<CropHandle | null>; onReady: (r: boolean) => void; webFile: File | null; onPickWeb: () => void; tools: React.ReactNode }) {
  const native = hasLibrary();
  const [status, setStatus] = useState<LibraryStatus | "loading">(native ? "loading" : "full");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState("");
  const loading = useRef(false);
  const file = useRef<HTMLInputElement>(null);

  const load = async (offset: number) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const r = await libraryList(offset, PAGE);
      setTotal(r.total);
      setItems((l) => (offset === 0 ? r.items : [...l, ...r.items]));
      if (offset === 0 && r.items[0]) pick(r.items[0].id);
    } catch {
      setError("사진 목록을 읽지 못했어요");
    } finally {
      loading.current = false;
    }
  };

  useEffect(() => {
    if (!native) return;
    libraryAccess()
      .then((s) => {
        setStatus(s);
        if (s !== "denied") load(0);
      })
      .catch(() => setStatus("denied"));
  }, []);

  // 고른 사진 원본 → 영역 고르기
  const pick = async (id: string) => {
    setPicked(id);
    setError("");
    try {
      const blob = await libraryFull(id);
      setSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch {
      setError("사진을 열지 못했어요");
    }
  };
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, []);

  const pickFile = (f: File) => {
    setSrc((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  };

  // 웹: 탭을 누를 때 바로 연 사진 고르기 창에서 고른 사진
  useEffect(() => { if (webFile) pickFile(webFile); }, [webFile]);

  const more = async () => {
    const s = await libraryMore().catch(() => status as LibraryStatus);
    setStatus(s);
    if (s !== "denied") load(0);
  };

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (items.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 300) load(items.length);
  };

  return (
    <>
      <CropEditor ref={crop} src={src} onReady={onReady} tools={tools} {...(native && status !== "denied" ? {} : { empty: "눌러서 사진 고르기", onEmptyTap: native ? () => file.current?.click() : onPickWeb })} />
      {error && <p className="cam-error">{error}</p>}
      <div className="album-grid" onScroll={onScroll}>
        {status === "limited" && <button className="album-more" onClick={more}>사진 더 고르기</button>}
        {status === "denied" && (
          <div className="album-empty">
            <p>사진 접근 권한이 없어요. 설정 → 식단 기록 → 사진에서 허용하거나 파일에서 골라 주세요.</p>
            <button className="cam-pick" onClick={() => file.current?.click()}>파일에서 고르기</button>
          </div>
        )}
        {!native && <p className="album-note">앨범 목록은 앱에서만 보여요. 웹에서는 위를 눌러 골라 주세요.</p>}
        {items.length > 0 && (
          <div className="album-cells">
            {items.map((it) => (
              <button key={it.id} className={picked === it.id ? "on" : ""} onClick={() => pick(it.id)} aria-label="사진 고르기" aria-pressed={picked === it.id}>
                <img src={it.thumb} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
        {status === "full" && native && items.length === 0 && !loading.current && <p className="album-note">사진이 없어요</p>}
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickFile(f); }} />
    </>
  );
}

export default function CameraScreen({ title = "카메라", onPhoto, onSkip, onClose }: {
  title?: string;
  onPhoto: (blob: Blob) => void;
  /** 없으면 건너뛰기 버튼을 숨김 */
  onSkip?: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"camera" | "album">("camera");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState("");
  const [torch, setTorch] = useState<boolean | null>(null); // null = 플래시 없음
  const [busy, setBusy] = useState(false);
  const [cropReady, setCropReady] = useState(false);
  // 찍은 사진 확인: 다시 촬영 / 확인
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const crop = useRef<CropHandle>(null);
  const webInput = useRef<HTMLInputElement>(null);
  const [webFile, setWebFile] = useState<File | null>(null);
  // 웹은 앨범 목록을 읽을 수 없어서, 사진앨범 탭을 누르면 바로 사진 고르기 창을 엶
  const openWebPicker = () => webInput.current?.click();

  // 카메라 켜기 (탭·앞뒤가 바뀌면 다시)
  useEffect(() => {
    if (tab !== "camera" || shot) return;
    let stop = false;
    setError("");
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } } });
        if (stop) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch(caps.torch ? false : null);
      } catch {
        if (!stop) setError("카메라를 켜지 못했어요. 설정에서 카메라 권한을 켜 주시거나 사진앨범에서 골라 주세요.");
      }
    })();
    return () => {
      stop = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [tab, facing, !!shot]);

  const toggleTorch = async () => {
    const t = stream.current?.getVideoTracks()[0];
    if (!t || torch === null) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const shoot = async () => {
    const v = video.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    try {
      const blob = await squareJpeg(v, v.videoWidth, v.videoHeight, facing === "user");
      setShot({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진을 찍지 못했어요");
    } finally {
      setBusy(false);
    }
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const b = await crop.current?.exportCrop().catch(() => null);
    if (b) onPhoto(b);
    else setBusy(false);
  };

  return createPortal(
    <div className={`cam ${tab}`} role="dialog" aria-label={tab === "album" ? "사진앨범" : title}>
      <header className="cam-head">
        <button className="cam-text" onClick={onClose}>취소</button>
        <b>{tab === "album" ? "사진앨범" : title}</b>
        <span className="cam-right">
          {onSkip && tab === "camera" && <button className="cam-text" onClick={onSkip}>직접 입력</button>}
        </span>
      </header>
      {tab === "camera" ? (
        <>
          <div className="cam-view">
            {shot && <img className="cam-shot" src={shot.url} alt="찍은 사진" />}
            {!error && !shot && <video ref={video} className={facing === "user" ? "mirror" : ""} playsInline muted autoPlay />}
            {error && (
              <div className="cam-empty">
                <p>{error}</p>
                <button className="cam-pick" onClick={() => { if (!hasLibrary()) openWebPicker(); setTab("album"); }}>사진앨범에서 고르기</button>
              </div>
            )}
            {!error && !shot && (
              <>
                {torch !== null && (
                  <button className={`cam-round left ${torch ? "on" : ""}`} onClick={toggleTorch} aria-label={torch ? "플래시 끄기" : "플래시 켜기"}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
                  </button>
                )}
                <button className="cam-round right" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} aria-label="앞뒤 카메라 바꾸기">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" /></svg>
                </button>
              </>
            )}
          </div>
          <div className="cam-shutter-area">
            {shot ? (
              <div className="cam-confirm">
                <button className="cam-retake" onClick={() => setShot(null)}>다시 촬영</button>
                <button className="cam-ok" onClick={() => onPhoto(shot.blob)}>확인</button>
              </div>
            ) : (
              !error && <button className="cam-shutter" onClick={shoot} disabled={busy} aria-label="사진 찍기"><i /></button>
            )}
          </div>
        </>
      ) : (
        <Album
          crop={crop}
          onReady={setCropReady}
          webFile={webFile}
          onPickWeb={openWebPicker}
          tools={
            <>
              {onSkip && <button className="crop-btn" onClick={onSkip}>직접 입력</button>}
              <button className="crop-btn primary" onClick={done} disabled={!cropReady || busy}>완료</button>
            </>
          }
        />
      )}
      <nav className="cam-tabs">
        <button className={tab === "album" ? "on" : ""} onClick={() => { if (!hasLibrary()) openWebPicker(); setTab("album"); }}>사진앨범</button>
        <button className={tab === "camera" ? "on" : ""} onClick={() => { setError(""); setCropReady(false); setShot(null); setTab("camera"); }}>카메라</button>
      </nav>
      <input ref={webInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setWebFile(f); }} />
    </div>,
    document.body,
  );
}
