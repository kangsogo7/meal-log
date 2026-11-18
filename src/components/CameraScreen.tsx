// 끼니 사진 찍기: 1:1 카메라 화면 (기본) + 사진앨범. 찍거나 고른 사진은 가운데를 1:1로 잘라 넘김.
// 건너뛰기 = 사진 없이 기록, 취소 = 닫기
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SIZE = 1080;

/** 이미지(카메라 화면·사진)의 가운데를 1:1로 잘라 JPEG로 */
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

async function fileToSquare(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (bmp) return squareJpeg(bmp, bmp.width, bmp.height);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await squareJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
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
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // 카메라 켜기 (탭·앞뒤가 바뀌면 다시)
  useEffect(() => {
    if (tab !== "camera") return;
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
  }, [tab, facing]);

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
      onPhoto(await squareJpeg(v, v.videoWidth, v.videoHeight, facing === "user"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진을 찍지 못했어요");
      setBusy(false);
    }
  };

  const pickFile = async (f: File) => {
    setBusy(true);
    try {
      onPhoto(await fileToSquare(f));
    } catch {
      setError("사진을 열지 못했어요");
      setBusy(false);
    }
  };

  const openAlbum = () => {
    setTab("album");
    file.current?.click();
  };

  return createPortal(
    <div className="cam" role="dialog" aria-label={title}>
      <header className="cam-head">
        <button className="cam-text" onClick={onClose}>취소</button>
        <b>{title}</b>
        <span />
      </header>
      <div className="cam-view">
        {tab === "camera" && !error && <video ref={video} className={facing === "user" ? "mirror" : ""} playsInline muted autoPlay />}
        {(tab === "album" || error) && (
          <div className="cam-empty">
            {error && <p>{error}</p>}
            <button className="cam-pick" onClick={openAlbum}>사진앨범에서 고르기</button>
          </div>
        )}
        {onSkip && <button className="cam-skip" onClick={onSkip}>건너뛰기</button>}
        {tab === "camera" && !error && (
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
        {tab === "camera" && !error && <button className="cam-shutter" onClick={shoot} disabled={busy} aria-label="사진 찍기"><i /></button>}
      </div>
      <nav className="cam-tabs">
        <button className={tab === "album" ? "on" : ""} onClick={openAlbum}>사진앨범</button>
        <button className={tab === "camera" ? "on" : ""} onClick={() => { setError(""); setTab("camera"); }}>카메라</button>
      </nav>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickFile(f); }} />
    </div>,
    document.body,
  );
}
