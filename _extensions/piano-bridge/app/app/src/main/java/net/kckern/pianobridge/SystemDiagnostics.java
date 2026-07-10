package net.kckern.pianobridge;

import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * SystemDiagnostics — ONE consolidated snapshot of everything the bridge can see,
 * served at GET /diagnostics for `pbctl diag`. It composes the piecemeal endpoints
 * (/cpu /info) with new signals (thermal, wall-clock time) and — crucially — the
 * two independent views of the co-resident Fully Kiosk app:
 *
 *   • kiosk.webview  — the KioskWatchdog verdict from the page heartbeat
 *                      (is the WebView actually presenting frames / stalled?).
 *   • kiosk.fkbApp   — FKB's OWN deviceInfo over REST (is the FKB app itself alive,
 *                      what URL/screen-state, how much RAM it sees). If unreachable,
 *                      FKB itself is wedged — a different failure from a stalled WebView.
 *
 * Nothing here throws: every section degrades to an {error|note} field so a single
 * SELinux-blocked read (e.g. thermal on this Knox build) never sinks the whole call.
 */
public final class SystemDiagnostics {

    private SystemDiagnostics() { }

    public static JSONObject snapshot(PianoBridgeService service) {
        JSONObject o = new JSONObject();
        DeviceConfig cfg = service.getConfig();
        try {
            o.put("ok", true);
            o.put("time", time());
            o.put("cpu", safe(() -> ProcStats.sample(500)));
            o.put("device", safe(() -> DeviceProbe.info(service)));
            o.put("thermal", safe(SystemDiagnostics::thermal));
            o.put("bridge", safe(() -> bridge(service)));
            o.put("kiosk", safe(() -> kiosk(service, cfg)));
            o.put("crash", safe(CrashLog::read));
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o;
    }

    private static JSONObject time() throws Exception {
        JSONObject o = new JSONObject();
        long wall = System.currentTimeMillis();
        o.put("epochMs", wall);
        o.put("iso", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", java.util.Locale.US).format(new java.util.Date(wall)));
        o.put("timezone", java.util.TimeZone.getDefault().getID());
        o.put("uptimeMs", SystemClock.elapsedRealtime());
        return o;
    }

    /**
     * Best-effort SoC/CPU/battery thermal-zone temps. On this Knox Android 10 an
     * untrusted_app may be SELinux-denied /sys/class/thermal — so we try, and if
     * nothing reads, we say so rather than pretend. Battery temp always available
     * via DeviceProbe (framework API), so that path is a guaranteed fallback.
     */
    private static JSONObject thermal() throws Exception {
        JSONObject o = new JSONObject();
        JSONArray zones = new JSONArray();
        int readable = 0;
        File base = new File("/sys/class/thermal");
        String[] names = base.list();
        if (names != null) {
            for (String n : names) {
                if (!n.startsWith("thermal_zone")) continue;
                String type = readTrim(new File(base, n + "/type"));
                String raw = readTrim(new File(base, n + "/temp"));
                if (raw == null) continue;
                try {
                    long milli = Long.parseLong(raw.trim());
                    // Zones report in mixed scales on this SoC (PMIC in milli-°C ≈ 36800;
                    // tsens sensors in a ×10 scale ≈ 325000 for ~32.5°C). Normalize by
                    // repeatedly /10 until the value is a plausible device temperature
                    // (< 150°C), so no zone reports a nonsense 325°C.
                    double c = milli;
                    while (Math.abs(c) > 150) c /= 10.0;
                    JSONObject z = new JSONObject();
                    z.put("zone", n);
                    z.put("type", type == null ? n : type);
                    z.put("tempC", Math.round(c * 10) / 10.0);
                    zones.put(z);
                    readable++;
                } catch (NumberFormatException ignored) { }
            }
        }
        o.put("zones", zones);
        o.put("readableZones", readable);
        if (readable == 0) o.put("note", "no thermal_zone readable (SELinux-denied on this build); see device.battery.temperatureC");
        return o;
    }

    private static JSONObject bridge(PianoBridgeService service) throws Exception {
        JSONObject o = new JSONObject();
        BleMidiConnector ble = service.getBleConnector();
        A2dpConnector spk = service.getA2dpConnector();
        AudioRouteGuard guard = service.getAudioGuard();
        o.put("engine", service.isEngineRunning() ? "running" : "stopped");
        o.put("ble", ble != null ? ble.status() : JSONObject.NULL);
        o.put("speaker", spk != null ? spk.status() : JSONObject.NULL);
        o.put("guard", guard != null ? guard.status() : JSONObject.NULL);
        o.put("uptimeMs", SystemClock.elapsedRealtime());
        return o;
    }

    private static JSONObject kiosk(PianoBridgeService service, DeviceConfig cfg) throws Exception {
        JSONObject o = new JSONObject();
        KioskWatchdog wd = service.getKioskWatchdog();
        o.put("webview", wd != null ? wd.snapshot() : JSONObject.NULL); // is the WebView presenting frames?
        o.put("fkbApp", FkbRest.deviceInfo(cfg));                        // is FKB itself alive + its own view
        return o;
    }

    // --- helpers ---

    private interface Supplier { JSONObject get() throws Exception; }

    /** Run a section, returning its JSON or {error:…} — never propagates. */
    private static JSONObject safe(Supplier s) {
        try { return s.get(); }
        catch (Throwable t) {
            JSONObject e = new JSONObject();
            try { e.put("error", String.valueOf(t.getMessage())); } catch (Exception ignored) { }
            return e;
        }
    }

    private static String readTrim(File f) {
        if (f == null || !f.exists()) return null;
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            byte[] b = new byte[128];
            int n = raf.read(b);
            return n > 0 ? new String(b, 0, n, StandardCharsets.UTF_8).trim() : null;
        } catch (Exception e) { return null; }
    }
}
