// 바코드 찍기 (앱에서만). 아이폰은 카메라 화면(AppDelegate.swift의 BarcodeScanPlugin),
// 안드로이드는 구글 바코드 스캐너(BarcodeScan.java, 카메라 권한 없이 구글 화면이 대신 찍음)
import { Capacitor, registerPlugin } from "@capacitor/core";

const Scanner = registerPlugin<{ scan(): Promise<{ code?: string }> }>("BarcodeScan");

export const canScanBarcode = () => Capacitor.isNativePlatform();

/** 찍은 바코드 숫자. 취소하면 null */
export async function scanBarcode(): Promise<string | null> {
  const r = await Scanner.scan();
  return r.code?.trim() || null;
}
