package io.github.kangsogo7.meallog;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * 앱 안 사진앨범: 최근 사진 목록(작은 미리보기)과 고른 사진 원본.
 * 웹 코드의 registerPlugin("PhotoLibrary")와 연결 (아이폰과 같은 이름·함수).
 */
@CapacitorPlugin(
    name = "PhotoLibrary",
    permissions = {
        @Permission(alias = "images", strings = { "android.permission.READ_MEDIA_IMAGES" }),
        @Permission(alias = "selected", strings = { "android.permission.READ_MEDIA_VISUAL_USER_SELECTED" }),
        @Permission(alias = "storage", strings = { "android.permission.READ_EXTERNAL_STORAGE" }),
    }
)
public class PhotoLibrary extends Plugin {
    private boolean has(String p) {
        return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED;
    }

    /** full = 모든 사진, limited = 고른 사진만(안드로이드 14+), denied = 권한 없음 */
    private String status() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (has("android.permission.READ_MEDIA_IMAGES")) return "full";
            if (Build.VERSION.SDK_INT >= 34 && has("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")) return "limited";
            return "denied";
        }
        return has("android.permission.READ_EXTERNAL_STORAGE") ? "full" : "denied";
    }

    @PluginMethod
    public void access(PluginCall call) {
        if (!status().equals("denied")) {
            JSObject r = new JSObject();
            r.put("status", status());
            call.resolve(r);
            return;
        }
        if (Build.VERSION.SDK_INT >= 34) requestPermissionForAliases(new String[] { "images", "selected" }, call, "accessDone");
        else if (Build.VERSION.SDK_INT >= 33) requestPermissionForAlias("images", call, "accessDone");
        else requestPermissionForAlias("storage", call, "accessDone");
    }

    @PermissionCallback
    private void accessDone(PluginCall call) {
        JSObject r = new JSObject();
        r.put("status", status());
        call.resolve(r);
    }

    /** 안드로이드 14에서 "고른 사진만"이면 사진을 더 고르게 (권한 창을 다시 띄움) */
    @PluginMethod
    public void more(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) requestPermissionForAliases(new String[] { "images", "selected" }, call, "accessDone");
        else accessDone(call);
    }

    /** 최근 사진부터 offset번째부터 limit장: { items: [{ id, thumb(base64 JPEG) }], total } */
    @PluginMethod
    public void list(PluginCall call) {
        int offset = call.getInt("offset", 0);
        int limit = call.getInt("limit", 40);
        new Thread(() -> {
            ContentResolver cr = getContext().getContentResolver();
            String[] proj = { MediaStore.Images.Media._ID, MediaStore.Images.Media.ORIENTATION };
            JSArray items = new JSArray();
            int total = 0;
            try (Cursor c = cr.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, proj, null, null, MediaStore.Images.Media.DATE_ADDED + " DESC")) {
                if (c != null) {
                    total = c.getCount();
                    if (offset < total && c.moveToPosition(offset)) {
                        int n = 0;
                        do {
                            long id = c.getLong(0);
                            int rot = c.isNull(1) ? 0 : c.getInt(1);
                            String thumb = thumb(cr, id, rot);
                            if (thumb != null) {
                                JSObject o = new JSObject();
                                o.put("id", String.valueOf(id));
                                o.put("thumb", thumb);
                                items.put(o);
                            }
                            n++;
                        } while (n < limit && c.moveToNext());
                    }
                }
            } catch (Exception e) {
                call.reject("사진 목록을 읽지 못했어요");
                return;
            }
            JSObject r = new JSObject();
            r.put("items", items);
            r.put("total", total);
            call.resolve(r);
        }).start();
    }

    private String thumb(ContentResolver cr, long id, int rot) {
        try {
            Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
            Bitmap b;
            if (Build.VERSION.SDK_INT >= 29) {
                b = cr.loadThumbnail(uri, new Size(240, 240), null);
            } else {
                b = MediaStore.Images.Thumbnails.getThumbnail(cr, id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                b = rotate(b, rot);
            }
            return b == null ? null : jpeg(b, 70);
        } catch (Exception e) {
            return null;
        }
    }

    /** 고른 사진 원본 (긴 변 max 이하): { data(base64 JPEG) } */
    @PluginMethod
    public void full(PluginCall call) {
        String sid = call.getString("id");
        int max = call.getInt("max", 2048);
        new Thread(() -> {
            try {
                long id = Long.parseLong(sid);
                ContentResolver cr = getContext().getContentResolver();
                Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                int rot = 0;
                try (Cursor c = cr.query(uri, new String[] { MediaStore.Images.Media.ORIENTATION }, null, null, null)) {
                    if (c != null && c.moveToFirst() && !c.isNull(0)) rot = c.getInt(0);
                }
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                try (InputStream in = cr.openInputStream(uri)) { BitmapFactory.decodeStream(in, null, o); }
                int sample = 1;
                while (Math.max(o.outWidth, o.outHeight) / (sample * 2) >= max) sample *= 2;
                BitmapFactory.Options o2 = new BitmapFactory.Options();
                o2.inSampleSize = sample;
                Bitmap b;
                try (InputStream in = cr.openInputStream(uri)) { b = BitmapFactory.decodeStream(in, null, o2); }
                if (b == null) throw new Exception("decode");
                float scale = Math.min(1f, (float) max / Math.max(b.getWidth(), b.getHeight()));
                if (scale < 1f) b = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * scale), Math.round(b.getHeight() * scale), true);
                b = rotate(b, rot);
                JSObject r = new JSObject();
                r.put("data", jpeg(b, 90));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("사진을 열지 못했어요");
            }
        }).start();
    }

    private static Bitmap rotate(Bitmap b, int deg) {
        if (b == null || deg % 360 == 0) return b;
        Matrix m = new Matrix();
        m.postRotate(deg);
        return Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
    }

    private static String jpeg(Bitmap b, int q) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, q, out);
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }
}
