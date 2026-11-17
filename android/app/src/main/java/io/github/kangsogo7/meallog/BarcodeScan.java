package io.github.kangsogo7.meallog;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/**
 * 바코드 찍기. 구글 바코드 스캐너 화면을 띄움 (카메라 권한 필요 없음, 구글 Play 서비스가 대신 찍음).
 * 웹 코드의 registerPlugin("BarcodeScan")과 연결 (아이폰과 같은 이름·함수). 찍으면 { code }, 닫으면 {}
 */
@CapacitorPlugin(name = "BarcodeScan")
public class BarcodeScan extends Plugin {
    @PluginMethod
    public void scan(PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_CODE_128)
                .enableAutoZoom()
                .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getActivity(), options);
        scanner.startScan()
                .addOnSuccessListener(barcode -> {
                    JSObject ret = new JSObject();
                    String code = barcode.getRawValue();
                    if (code != null) ret.put("code", code);
                    call.resolve(ret);
                })
                .addOnCanceledListener(() -> call.resolve(new JSObject()))
                .addOnFailureListener(e -> call.reject("바코드 스캐너를 열지 못했어요. 잠시 뒤 다시 해 주세요."));
    }
}
