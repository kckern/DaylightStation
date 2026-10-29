package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * FkbRest — thin client for the co-resident Fully Kiosk Browser REST API on
 * localhost:2323. The bridge lives in the same device as FKB and drives it over
 * this channel for two jobs the WebView itself can't do once it's stalled:
 *
 *   1. Recovery actions (KioskWatchdog escalation ladder): loadStartUrl (reload),
 *      restartApp (renderer respawn), rebootDevice (last resort for the hard latch).
 *   2. FKB-app introspection (SystemDiagnostics): deviceInfo gives FKB's OWN view of
 *      the tablet (RAM, screen state, current URL) and doubles as an FKB-liveness
 *      probe — if this doesn't answer, FKB itself is wedged, which is a DIFFERENT
 *      failure from the WebView being frame-stalled.
 *
 * Every call needs the FKB password (config key `fkbPassword`). It is currently the
 * one piece of config that must be set at deploy (`pbctl config set fkbPassword …`)
 * or these calls 401 — see ScreenWaker's hasPassword log.
 */
public final class FkbRest {

    private static final String TAG = "PianoBridge-FKB";

    private FkbRest() { }

    // --- auth state ---------------------------------------------------------
    //
    // FKB answers a wrong password with HTTP 200 and {"status":"Error","statustext":
    // "Please login"}. On 2026-10-14 a stale fkbPassword made every call get that, and
    // every caller read it as success or "unknown": the foreground guard sat at UNKNOWN
    // while a child was in the Play Store for 40 minutes, the settings guard said OK,
    // and the recovery ladder's commands were no-ops. So every call records whether
    // FKB accepted the password, and authFailing() makes that state visible.

    private static volatile long lastAuthOkAtMs = 0;
    private static volatile long lastAuthFailAtMs = 0;

    static void recordAuth(boolean ok) {
        long now = System.currentTimeMillis();
        // Strictly increasing, so two records in the same millisecond still order.
        if (ok) lastAuthOkAtMs = Math.max(now, lastAuthFailAtMs + 1);
        else lastAuthFailAtMs = Math.max(now, lastAuthOkAtMs + 1);
    }

    /** True when FKB's most recent answer to this bridge was a login refusal. */
    public static boolean authFailing() { return lastAuthFailAtMs > lastAuthOkAtMs; }

    /** Epoch ms of the most recent login refusal, 0 if none since boot. */
    public static long lastAuthFailAtMs() { return lastAuthFailAtMs; }

    /**
     * The statustext of an FKB error envelope ({"status":"Error",…}), or null when the
     * body is anything else: an OK ack, a payload (deviceInfo/listSettings carry no
     * status key), non-JSON, or empty.
     */
    static String errorEnvelope(String body) {
        if (body == null) return null;
        String t = body.trim();
        if (!t.startsWith("{")) return null;
        try {
            JSONObject o = new JSONObject(t);
            if (!"Error".equalsIgnoreCase(o.optString("status", ""))) return null;
            String text = o.optString("statustext", "");
            return text.isEmpty() ? "Error" : text;
        } catch (Exception e) {
            return null;
        }
    }

    private static String base(DeviceConfig cfg) {
        return "http://" + cfg.fkbHost() + ":" + cfg.fkbPort() + "/";
    }

    private static String url(DeviceConfig cfg, String cmd, boolean json) {
        Map<String, String> p = null;
        if (json) { p = new LinkedHashMap<>(); p.put("type", "json"); }
        return buildUrl(cfg.fkbHost(), cfg.fkbPort(), cfg.fkbPassword(), cmd, p);
    }

    /**
     * Pure URL construction — extracted so it is assertable without a device.
     *
     * Shape: {@code http://host:port/?cmd=<cmd>[&k=v…]&password=<pw>}. EVERY component
     * is percent-encoded, not just the password: a param value carrying {@code &} or
     * {@code =} (a start URL, say) would otherwise split the query string and hand FKB
     * a mangled command. Params are emitted in the map's iteration order, so pass a
     * {@link LinkedHashMap} when the exact output matters.
     */
    static String buildUrl(String host, int port, String password, String cmd, Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        sb.append("http://").append(host).append(':').append(port).append("/?cmd=").append(enc(cmd));
        if (params != null) {
            for (Map.Entry<String, String> e : params.entrySet()) {
                sb.append('&').append(enc(e.getKey())).append('=').append(enc(e.getValue()));
            }
        }
        sb.append("&password=").append(enc(password == null ? "" : password));
        return sb.toString();
    }

    /**
     * Fire an FKB command (loadStartUrl/restartApp/rebootDevice/screenOn/…) and
     * return the HTTP status code, or -1 on transport failure. Used for recovery
     * actions where we only care that FKB accepted the command.
     */
    public static int command(DeviceConfig cfg, String cmd) {
        return command(cfg, cmd, null);
    }

    /**
     * Fire an FKB command WITH query params — e.g.
     * {@code command(cfg, "setBooleanSetting", {key:"kioskMode", value:"true"})}.
     * Returns the HTTP status code, or -1 on transport failure.
     */
    public static int command(DeviceConfig cfg, String cmd, Map<String, String> params) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(
                    buildUrl(cfg.fkbHost(), cfg.fkbPort(), cfg.fkbPassword(), cmd, params)).openConnection();
            c.setConnectTimeout(3000);
            c.setReadTimeout(4000);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            if (code >= 200 && code < 400) {
                String err = errorEnvelope(drain(c.getInputStream()));
                if (err != null) {
                    // HTTP 200, but FKB refused it. Report it as the 401 it is, so
                    // callers' 2xx checks stop counting it as done.
                    recordAuth(false);
                    Log.w(TAG, "cmd " + cmd + " -> refused by FKB: " + err);
                    return 401;
                }
                recordAuth(true);
            }
            Log.i(TAG, "cmd " + cmd + " -> HTTP " + code);
            return code;
        } catch (Exception e) {
            Log.w(TAG, "cmd " + cmd + " failed: " + e.getMessage());
            return -1;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** True if FKB's REST server answered (the app process is alive), regardless of auth. */
    public static boolean reachable(DeviceConfig cfg) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base(cfg)).openConnection();
            c.setConnectTimeout(2000);
            c.setReadTimeout(2500);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            return code > 0;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * FKB's own deviceInfo as JSON — FKB's view of RAM/battery/screen/URL, plus a
     * `reachable` flag. Never throws; on failure returns {reachable:false,error:…}.
     */
    public static JSONObject deviceInfo(DeviceConfig cfg) {
        JSONObject o = new JSONObject();
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url(cfg, "deviceInfo", true)).openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(4000);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            InputStream in = code >= 200 && code < 400 ? c.getInputStream() : c.getErrorStream();
            String body = drain(in);
            o.put("reachable", true);
            o.put("httpCode", code);
            String err = errorEnvelope(body);
            if (err != null) {
                recordAuth(false);
                o.put("authOk", false);
                o.put("note", "FKB refused the password: " + err);
                return o;
            }
            try {
                JSONObject info = new JSONObject(body);
                recordAuth(true);
                o.put("authOk", true);
                // Surface the fields that actually matter for "is the kiosk OK".
                o.put("screenOn", info.opt("screenOn"));
                o.put("currentPageUrl", info.opt("currentTabUrl") != null && !info.isNull("currentTabUrl")
                        ? info.opt("currentTabUrl") : info.opt("startUrl"));
                o.put("foreground", info.opt("foregroundApp"));
                o.put("ramFreeMb", asMb(info.optLong("ramFreeMemory", -1)));
                o.put("ramTotalMb", asMb(info.optLong("ramTotalMemory", -1)));
                o.put("appVersion", info.opt("appVersionName"));
                o.put("batteryLevel", info.opt("batteryLevel"));
                o.put("wifiSignal", info.opt("wifiSignalLevel"));
                // FKB still reports the BSSID when Android redacts it from us (WifiLink, p35).
                o.put("bssid", info.opt("BSSID"));
            } catch (Exception parse) {
                // Non-JSON (e.g. a login page) means the password is wrong/missing.
                o.put("authOk", false);
                o.put("note", "deviceInfo not JSON — fkbPassword missing/wrong?");
            }
        } catch (Exception e) {
            try { o.put("reachable", false).put("error", String.valueOf(e.getMessage())); }
            catch (Exception ignored) { }
        } finally {
            if (c != null) c.disconnect();
        }
        return o;
    }

    /**
     * FKB's full live settings map (`cmd=listSettings&type=json`), values normalized
     * to strings — FKB emits booleans and numbers unquoted, so {@code kioskMode} comes
     * back as {@code "true"} and {@code reloadPageFailure} as {@code "30"}.
     *
     * <p><b>Empty means UNKNOWN, never "everything is wrong."</b> Unreachable FKB, a
     * wrong password (an HTTP-200 {"status":"Error"} envelope; see authFailing), a truncated body — all return an
     * empty map. {@link KioskSettings#detect} treats empty as "no drift", so a network
     * blip can never trigger a blind rewrite of every setting.
     */
    public static Map<String, String> listSettings(DeviceConfig cfg) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url(cfg, "listSettings", true)).openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(5000);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            if (code < 200 || code >= 400) {
                Log.w(TAG, "listSettings -> HTTP " + code);
                return Collections.emptyMap();
            }
            String body = drain(c.getInputStream());
            String err = errorEnvelope(body);
            if (err != null) {
                recordAuth(false);
                Log.w(TAG, "listSettings -> refused by FKB: " + err);
                return Collections.emptyMap();
            }
            Map<String, String> out = parseSettings(body);
            if (!out.isEmpty()) recordAuth(true);
            return out;
        } catch (Exception e) {
            Log.w(TAG, "listSettings failed: " + e.getMessage());
            return Collections.emptyMap();
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * Parse a flat FKB settings JSON object into a string map. Pure and total: any
     * malformed / non-JSON / null input yields an EMPTY map (see listSettings).
     * Nested values (FKB has none at time of writing) are skipped rather than
     * stringified into something a comparison could misread.
     */
    static Map<String, String> parseSettings(String body) {
        if (body == null || body.trim().isEmpty()) return Collections.emptyMap();
        if (errorEnvelope(body) != null) return Collections.emptyMap();
        LinkedHashMap<String, String> out = new LinkedHashMap<>();
        try {
            JSONObject o = new JSONObject(body);
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String k = it.next();
                Object v = o.opt(k);
                if (v == null || v == JSONObject.NULL) continue;
                if (v instanceof org.json.JSONObject || v instanceof org.json.JSONArray) continue;
                out.put(k, String.valueOf(v));
            }
        } catch (Exception e) {
            // Non-JSON body (login page / garbage) — unknown, not drifted.
            return Collections.emptyMap();
        }
        return out;
    }

    private static long asMb(long bytes) { return bytes < 0 ? -1 : bytes / (1024 * 1024); }

    private static String drain(InputStream in) {
        if (in == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] b = new byte[4096];
        int n;
        try { while ((n = in.read(b)) > 0 && bos.size() < 262144) bos.write(b, 0, n); }
        catch (Exception ignored) { }
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String enc(String s) {
        try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
    }
}
