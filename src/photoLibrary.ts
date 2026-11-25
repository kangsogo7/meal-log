// 앱 안 사진앨범 (앱에서만): 최근 사진 미리보기 목록과 고른 사진 원본.
// 아이폰은 AppDelegate.swift의 PhotoLibraryPlugin, 안드로이드는 PhotoLibrary.java
import { Capacitor, registerPlugin } from "@capacitor/core";

export type LibraryStatus = "full" | "limited" | "denied";
export interface LibraryItem { id: string; thumb: string }

const Lib = registerPlugin<{
  access(): Promise<{ status: LibraryStatus }>;
  more(): Promise<{ status: LibraryStatus }>;
  list(o: { offset: number; limit: number }): Promise<{ items: { id: string; thumb: string }[]; total: number }>;
  full(o: { id: string; max: number }): Promise<{ data: string }>;
  /** base64 JPEG를 앨범에 그대로 저장 */
  save(o: { data: string }): Promise<void>;
}>("PhotoLibrary");

export const hasLibrary = () => Capacitor.isNativePlatform();

/** 권한 확인 (처음이면 물어봄) */
export const libraryAccess = async () => (await Lib.access()).status;

/** "선택한 사진만" 허용일 때 사진 더 고르기 */
export const libraryMore = async () => (await Lib.more()).status;

/** 최근 사진부터 limit장 (미리보기는 바로 쓸 수 있는 주소로) */
export async function libraryList(offset: number, limit = 40): Promise<{ items: LibraryItem[]; total: number }> {
  const r = await Lib.list({ offset, limit });
  return { total: r.total, items: r.items.map((i) => ({ id: i.id, thumb: `data:image/jpeg;base64,${i.thumb}` })) };
}

/** 고른 사진 원본 (긴 변 max 이하) → Blob */
export async function libraryFull(id: string, max = 2048): Promise<Blob> {
  const { data } = await Lib.full({ id, max });
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

/** 사진을 휴대폰 앨범에 그대로 저장. 웹은 공유 창(아이폰 "이미지 저장") 또는 내려받기 */
export async function savePhoto(blob: Blob, name = "식단기록.jpg"): Promise<"saved" | "shared" | "downloaded"> {
  if (Capacitor.isNativePlatform()) {
    const data = await new Promise<string>((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",")[1] ?? "");
      r.onerror = () => fail(r.error);
      r.readAsDataURL(blob);
    });
    await Lib.save({ data });
    return "saved";
  }
  const file = new File([blob], name, { type: blob.type || "image/jpeg" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
