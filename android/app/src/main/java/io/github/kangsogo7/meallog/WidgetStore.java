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

    /** 물 한 잔: 위젯 숫자를 바로 올리고, 앱이 열릴 때 기록하도록 쌓아 둠 (물 위젯 · 빠른 설정 버튼) */
    static synchronized void addWater(Context c) {
        try {
            JSONObject s = state(c);
            JSONObject w = s.optJSONObject("water");
            if (w == null) {
                w = new JSONObject().put("ml", 0).put("goalMl", 2000).put("cupMl", 250);
                s.put("water", w);
            }
            int cup = Math.max(1, w.optInt("cupMl", 250));
            w.put("ml", w.optInt("ml", 0) + cup);
            saveState(c, s);
            addPending(c, new JSONObject().put("type", "water").put("date", s.optString("date")).put("ml", cup));
            refreshAll(c);
        } catch (Exception ignored) {
        }
    }

    /** 오늘 마신 잔 / 목표 잔 */
    static int[] waterCups(Context c) {
        JSONObject w = state(c).optJSONObject("water");
        int ml = w != null ? w.optInt("ml", 0) : 0;
        int goal = w != null ? w.optInt("goalMl", 2000) : 2000;
        int cup = w != null ? Math.max(1, w.optInt("cupMl", 250)) : 250;
        return new int[] { ml / cup, Math.max(1, (int) Math.ceil(goal / (double) cup)) };
    }

    /** 위젯 3개와 빠른 설정 버튼 모두 다시 그리기 */
    static void refreshAll(Context c) {
        refresh(c, WaterWidget.class);
        refresh(c, SuppWidget.class);
        refresh(c, MealWidget.class);
        try {
            android.service.quicksettings.TileService.requestListeningState(c, new ComponentName(c, WaterTile.class));
        } catch (Exception ignored) {
        }
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
