package io.github.kangsogo7.meallog;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 위젯이 보여 줄 오늘 상태(앱이 넣어 줌)와, 위젯에서 누른 것들(앱이 열릴 때 가져가 기록에 반영)을 저장.
 * state: {"date","water":{"ml","goalMl","cupMl"},"supps":[{"id","name","on"}],"kcal","meals":[{"key","label","kcal"}]}
 */
final class WidgetStore {
    private static final String PREFS = "meallog_widgets";

    private WidgetStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** 오늘 상태. 날짜가 지났으면 물·영양제는 0으로 */
    static JSONObject state(Context c) {
        try {
            JSONObject s = new JSONObject(prefs(c).getString("state", "{}"));
            if (!today().equals(s.optString("date"))) {
                s.put("date", today());
                JSONObject w = s.optJSONObject("water");
                if (w != null) w.put("ml", 0);
                JSONArray supps = s.optJSONArray("supps");
                if (supps != null) for (int i = 0; i < supps.length(); i++) supps.getJSONObject(i).put("on", false);
                s.put("kcal", 0);
                JSONArray meals = s.optJSONArray("meals");
                if (meals != null) for (int i = 0; i < meals.length(); i++) meals.getJSONObject(i).put("kcal", 0);
            }
            return s;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static void saveState(Context c, JSONObject s) {
        prefs(c).edit().putString("state", s.toString()).apply();
    }

    static synchronized void addPending(Context c, JSONObject action) {
        try {
            JSONArray list = new JSONArray(prefs(c).getString("pending", "[]"));
            list.put(action);
            prefs(c).edit().putString("pending", list.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static synchronized String takePending(Context c) {
        String s = prefs(c).getString("pending", "[]");
        prefs(c).edit().putString("pending", "[]").apply();
        return s;
    }

    /** 위젯 3개 모두 다시 그리기 */
    static void refreshAll(Context c) {
        refresh(c, WaterWidget.class);
        refresh(c, SuppWidget.class);
        refresh(c, MealWidget.class);
    }

    private static void refresh(Context c, Class<?> cls) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, cls));
        if (ids.length == 0) return;
        Intent i = new Intent(c, cls);
        i.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        c.sendBroadcast(i);
    }
}
