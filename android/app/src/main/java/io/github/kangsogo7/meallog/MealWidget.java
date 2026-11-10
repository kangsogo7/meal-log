package io.github.kangsogo7.meallog;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** 식단 위젯: 오늘 칼로리 + 아침·점심·간식·저녁 (누르면 앱의 그 끼니 기록 화면) */
public class MealWidget extends AppWidgetProvider {
    private static final String[] KEYS = { "breakfast", "lunch", "snack", "dinner" };
    private static final String[] LABELS = { "아침", "점심", "간식", "저녁" };
    private static final int[] BTNS = { R.id.meal0, R.id.meal1, R.id.meal2, R.id.meal3 };

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        JSONObject s = WidgetStore.state(c);
        JSONArray meals = s.optJSONArray("meals");
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_meal);
            v.setTextViewText(R.id.meal_kcal, String.format("%,d kcal", s.optInt("kcal", 0)));
            for (int k = 0; k < KEYS.length; k++) {
                int kcal = 0;
                if (meals != null) {
                    for (int j = 0; j < meals.length(); j++) {
                        JSONObject x = meals.optJSONObject(j);
                        if (x != null && KEYS[k].equals(x.optString("key"))) kcal = x.optInt("kcal", 0);
                    }
                }
                v.setTextViewText(BTNS[k], kcal > 0 ? LABELS[k] + "\n" + kcal : LABELS[k] + "\n+");
                Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("meallog://add?meal=" + KEYS[k]), c, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                v.setOnClickPendingIntent(BTNS[k], PendingIntent.getActivity(c, 300 + k, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }
            v.setOnClickPendingIntent(R.id.meal_root, WaterWidget.openApp(c));
            m.updateAppWidget(id, v);
        }
    }
}
