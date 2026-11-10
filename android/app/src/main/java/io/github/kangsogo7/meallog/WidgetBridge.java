package io.github.kangsogo7.meallog;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/** 앱(웹) ↔ 홈 화면 위젯 연결 (src/widgets.ts) */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridge extends Plugin {

    /** 앱이 오늘 상태를 넣으면 위젯을 다시 그림 */
    @PluginMethod
    public void update(PluginCall call) {
        try {
            WidgetStore.saveState(getContext(), new JSONObject(call.getString("state", "{}")));
            WidgetStore.refreshAll(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** 위젯에서 누른 것들 (가져가면 비움) */
    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject r = new JSObject();
        r.put("actions", WidgetStore.takePending(getContext()));
        call.resolve(r);
    }
}
