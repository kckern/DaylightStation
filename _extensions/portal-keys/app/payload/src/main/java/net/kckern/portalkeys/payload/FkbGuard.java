package net.kckern.portalkeys.payload;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

/** Checks/relocks Fully independently of the Home and native-policy checking thread. */
final class FkbGuard {
    private final SharedPreferences config;
    private final Consumer<String> report;
    private final HandlerThread thread = new HandlerThread("portal-fully-guard");
    private Handler handler;
    private volatile boolean stopped, secure;
    private volatile long checkedAt;
    private volatile String error = "not-yet-checked";
    private boolean lastReported;
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (stopped) return;
            try {
                JSONObject info = call("deviceInfo", null, null);
                secure = info.optBoolean("kioskMode", false) && info.optBoolean("kioskLocked", false);
                error = secure ? null : "fully-kiosk-disarmed";
                checkedAt = System.currentTimeMillis();
                if (secure != lastReported) {
                    report.accept(secure ? "fkb-restored" : "fkb-lost"); lastReported = secure;
                }
                if (!secure) {
                    call("setBooleanSetting", "key", "kioskMode");
                    call("lockKiosk", null, null);
                    // Recovery is only accepted after the next deviceInfo readback.
                }
            } catch (Exception e) {
                secure = false; error = e.getClass().getSimpleName(); checkedAt = System.currentTimeMillis();
                if (lastReported) { report.accept("fkb-lost"); lastReported = false; }
            }
            handler.postDelayed(this, 2000);
        }
    };
    FkbGuard(Context c, Consumer<String> report) {
        config = c.getSharedPreferences("portalkeys", Context.MODE_PRIVATE); this.report = report;
        lastReported = c.getSharedPreferences("home-watchdog", Context.MODE_PRIVATE).getBoolean("fkbSecure", true);
    }
    void start() { thread.start(); handler = new Handler(thread.getLooper()); handler.post(poll); }
    void stop() { stopped = true; if (handler != null) handler.removeCallbacksAndMessages(null); thread.quitSafely(); }
    boolean secure() { return secure && checkedAt > 0 && System.currentTimeMillis() - checkedAt < 10000; }
    long checkedAt() { return checkedAt; }
    JSONObject status() throws Exception {
        return new JSONObject().put("secure", secure()).put("checkedAt", checkedAt)
                .put("error", error == null ? JSONObject.NULL : error);
    }
    private JSONObject call(String command, String key, String value) throws Exception {
        String password = config.getString("fkbPassword", "");
        if (password.isEmpty()) throw new IllegalStateException("missing-fully-credential");
        Uri.Builder b = new Uri.Builder().scheme("http").encodedAuthority("127.0.0.1:2323")
                .appendQueryParameter("cmd", command).appendQueryParameter("type", "json")
                .appendQueryParameter("password", password);
        if (key != null) { b.appendQueryParameter(key, value); b.appendQueryParameter("value", "true"); }
        HttpURLConnection c = (HttpURLConnection)new URL(b.build().toString()).openConnection();
        c.setConnectTimeout(1500); c.setReadTimeout(1500); c.setInstanceFollowRedirects(false);
        try {
            if (c.getResponseCode() != 200) throw new IllegalStateException("fully-http-error");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] bytes = new byte[4096]; int n;
                while ((n = in.read(bytes)) >= 0) {
                    if (out.size() + n > 262144) throw new IllegalStateException("fully-response-too-large");
                    out.write(bytes, 0, n);
                }
            }
            JSONObject a = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
            if (a.optString("status").equalsIgnoreCase("Error")) throw new IllegalStateException("fully-request-rejected");
            return a;
        } finally { c.disconnect(); }
    }
}
