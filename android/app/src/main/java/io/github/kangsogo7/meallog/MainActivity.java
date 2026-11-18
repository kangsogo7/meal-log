package io.github.kangsogo7.meallog;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 홈 화면 위젯 연결·바코드 (앱 안 플러그인은 super.onCreate 전에 등록)
        registerPlugin(WidgetBridge.class);
        registerPlugin(BarcodeScan.class);
        registerPlugin(PhotoLibrary.class);
        super.onCreate(savedInstanceState);
    }
}
