package io.github.kangsogo7.meallog;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import android.os.Environment;
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
import java.io.OutputStream;

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
        @Permission(alias = "write", strings = { "android.permission.WRITE_EXTERNAL_STORAGE" }),
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

    /** base64 이미지를 공유 창(카톡 등)으로: 앱 캐시에 파일로 두고 FileProvider로 넘김 */
    @PluginMethod
    public void share(PluginCall call) {
        String b64 = call.getString("data");
        String name = call.getString("name", "share.png");
        String mime = call.getString("mimeType", "image/png");
        if (b64 == null || b64.isEmpty()) {
            call.reject("이미지가 비어 있어요");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            dir.mkdirs();
            File f = new File(dir, name.replaceAll("[^0-9A-Za-z._-]", "_"));
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(Base64.decode(b64, Base64.DEFAULT)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, null);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                getActivity().startActivity(chooser);
                call.resolve();
            });
        } catch (Exception e) {
            call.reject("공유 창을 열지 못했어요");
        }
    }

    /** base64 JPEG를 사진 앨범(Pictures/식단기록)에 그대로 저장 */
    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 && !has("android.permission.WRITE_EXTERNAL_STORAGE")) {
            requestPermissionForAlias("write", call, "saveDone");
            return;
        }
        doSave(call);
    }

    @PermissionCallback
    private void saveDone(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 && !has("android.permission.WRITE_EXTERNAL_STORAGE")) {
            call.reject("사진 저장 권한이 없어요");
            return;
        }
        doSave(call);
    }

    private void doSave(PluginCall call) {
        String b64 = call.getString("data");
        if (b64 == null || b64.isEmpty()) {
            call.reject("사진이 비어 있어요");
            return;
        }
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, "meal_" + System.currentTimeMillis() + ".jpg");
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                if (Build.VERSION.SDK_INT >= 29) {
                    v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/식단기록");
                    v.put(MediaStore.Images.Media.IS_PENDING, 1);
                }
                Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("insert");
                try (OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) throw new Exception("open");
                    out.write(bytes);
                }
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Images.Media.IS_PENDING, 0);
                    cr.update(uri, done, null, null);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("저장하지 못했어요");
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
