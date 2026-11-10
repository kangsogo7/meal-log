package io.github.kangsogo7.meallog;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** 영양제 위젯: 최대 4개, 누르면 먹음/안 먹음 바로 체크 (앱이 열릴 때 기록에 반영) */
public class SuppWidget extends AppWidgetProvider {
    static final String ACTION_TOGGLE = "io.github.kangsogo7.meallog.SUPP_TOGGLE";
    private static final int[] ROWS = { R.id.supp0, R.id.supp1, R.id.supp2, R.id.supp3 };

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        JSONArray supps = WidgetStore.state(c).optJSONArray("supps");
        int n = supps == null ? 0 : Math.min(4, supps.length());
        int taken = 0;
        for (int k = 0; k < n; k++) if (supps.optJSONObject(k).optBoolean("on")) taken++;

        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_supp);
            v.setTextViewText(R.id.supp_count, n == 0 ? "" : taken + " / " + n + "개");
            v.setViewVisibility(R.id.supp_empty, n == 0 ? View.VISIBLE : View.GONE);
            for (int k = 0; k < ROWS.length; k++) {
                if (k >= n) {
                    v.setViewVisibility(ROWS[k], View.GONE);
                    continue;
                }
                JSONObject s = supps.optJSONObject(k);
                boolean on = s.optBoolean("on");
                v.setViewVisibility(ROWS[k], View.VISIBLE);
                v.setTextViewText(ROWS[k], (on ? "●  " : "○  ") + s.optString("name"));
                v.setInt(ROWS[k], "setBackgroundResource", on ? R.drawable.widget_chip_on : R.drawable.widget_chip_off);
                Intent t = new Intent(c, SuppWidget.class).setAction(ACTION_TOGGLE).putExtra("index", k);
                v.setOnClickPendingIntent(ROWS[k], PendingIntent.getBroadcast(c, 200 + k, t, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }
            v.setOnClickPendingIntent(R.id.supp_root, WaterWidget.openApp(c));
            m.updateAppWidget(id, v);
        }
    }

    @Override
    public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        if (!ACTION_TOGGLE.equals(i.getAction())) return;
        try {
            JSONObject state = WidgetStore.state(c);
            JSONArray supps = state.optJSONArray("supps");
            int k = i.getIntExtra("index", -1);
            if (supps == null || k < 0 || k >= supps.length()) return;
            JSONObject s = supps.getJSONObject(k);
            boolean on = !s.optBoolean("on");
            s.put("on", on);
            WidgetStore.saveState(c, state);
            WidgetStore.addPending(c, new JSONObject().put("type", "supp").put("date", state.optString("date")).put("id", s.optString("id")).put("on", on));
            WidgetStore.refreshAll(c);
        } catch (Exception ignored) {
        }
    }
}
