package io.github.kangsogo7.meallog;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 물 위젯: 오늘 몇 잔인지 + "+1잔" 버튼 (누르면 바로 기록, 앱이 열릴 때 기록에 반영) */
public class WaterWidget extends AppWidgetProvider {
    static final String ACTION_ADD = "io.github.kangsogo7.meallog.WATER_ADD";

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        JSONObject s = WidgetStore.state(c);
        JSONObject w = s.optJSONObject("water");
        int ml = w != null ? w.optInt("ml", 0) : 0;
        int goal = w != null ? w.optInt("goalMl", 2000) : 2000;
        int cup = w != null ? Math.max(1, w.optInt("cupMl", 250)) : 250;
        int cups = Math.max(1, (int) Math.ceil(goal / (double) cup));
        int filled = ml / cup;

        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_water);
            v.setTextViewText(R.id.water_count, filled + " / " + cups + "잔");
            v.setProgressBar(R.id.water_bar, cups, Math.min(filled, cups), false);
            v.setOnClickPendingIntent(R.id.water_add, PendingIntent.getBroadcast(c, 101,
                new Intent(c, WaterWidget.class).setAction(ACTION_ADD), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            v.setOnClickPendingIntent(R.id.water_root, openApp(c));
            m.updateAppWidget(id, v);
        }
    }

    @Override
    public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        if (!ACTION_ADD.equals(i.getAction())) return;
        try {
            JSONObject s = WidgetStore.state(c);
            JSONObject w = s.optJSONObject("water");
            if (w == null) {
                w = new JSONObject().put("ml", 0).put("goalMl", 2000).put("cupMl", 250);
                s.put("water", w);
            }
            int cup = Math.max(1, w.optInt("cupMl", 250));
            w.put("ml", w.optInt("ml", 0) + cup);
            WidgetStore.saveState(c, s);
            WidgetStore.addPending(c, new JSONObject().put("type", "water").put("date", s.optString("date")).put("ml", cup));
            WidgetStore.refreshAll(c);
        } catch (Exception ignored) {
        }
    }

    static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 100, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
