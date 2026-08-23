package net.kckern.pianobridge;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;

/**
 * StatusPage — the bridge's self-reported diagnosis, as one HTML page at
 * {@code http://<tablet>:8770/}.
 *
 * For a tablet nobody can walk up to, "open a URL and read it" beats "run six
 * pbctl commands and correlate". This renders what the control plane already
 * knows — SystemDiagnostics, the heartbeat, the payload loader, the a11y service,
 * the recent event ring — into a page a phone can read. It probes nothing new.
 *
 * Server-rendered, no JS, no external assets: the page must work when the tablet
 * is on a degraded link and must never itself become a reason the bridge breaks.
 * Auto-refreshes every 30s via a meta tag. Same LAN-only trust model as :8770.
 */
public final class StatusPage {

    private StatusPage() { }

    /** First non-loopback IPv4 on any interface — what to put in a bookmark. */
    static String ipAddress() {
        try {
            List<NetworkInterface> ifs = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface nif : ifs) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InetAddress a : Collections.list(nif.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) return a.getHostAddress() + " (" + nif.getName() + ")";
                }
            }
        } catch (Exception ignored) { }
        return "?";
    }

    public static String render(BridgeCore core) {
        JSONObject d = SystemDiagnostics.snapshot(core);
        JSONObject bridge = d.optJSONObject("bridge");
        JSONObject ble = bridge == null ? null : bridge.optJSONObject("ble");
        JSONObject speaker = bridge == null ? null : bridge.optJSONObject("speaker");
        JSONObject kiosk = d.optJSONObject("kiosk");
        JSONObject webview = kiosk == null ? null : kiosk.optJSONObject("webview");
        JSONObject fkb = kiosk == null ? null : kiosk.optJSONObject("fkbApp");
        JSONObject guard = kiosk == null ? null : kiosk.optJSONObject("settings");
        JSONObject dev = d.optJSONObject("device");
        JSONObject time = d.optJSONObject("time");
        JSONObject cpu = d.optJSONObject("cpu");
        JSONObject thermal = d.optJSONObject("thermal");
        JSONObject payload = null;
        try { payload = new JSONObject(core.getShell().payloadStatusJson()); } catch (Exception ignored) { }
        Heartbeat hb = core.getHeartbeat();
        JSONObject beat = hb == null ? null : hb.snapshot();

        String bleState = s(ble, "state");
        boolean bleOk = "CONNECTED".equals(bleState);
        boolean writeOk = core.isMidiWriteOpen();
        boolean inOk = core.isMidiPortOpen();
        boolean a11y = A11y.isConnected();
        boolean fkbOk = fkb != null && fkb.optBoolean("reachable", false);
        String verdict = s(webview, "verdict");
        boolean pageOk = "HEALTHY".equals(verdict) || "SCREEN_OFF".equals(verdict) || "GRACE".equals(verdict) || "BUILDING".equals(verdict);
        boolean beatOk = beat != null && beat.optLong("lastOkAgoMs", -1) >= 0 && beat.optLong("lastOkAgoMs", -1) < 3 * beat.optLong("intervalMs", 60000);
        boolean allOk = bleOk && writeOk && inOk && fkbOk && pageOk;

        StringBuilder h = new StringBuilder(16000);
        h.append("<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>")
         .append("<meta http-equiv=refresh content=30><title>Piano Bridge</title><style>")
         .append("body{font:15px/1.45 -apple-system,system-ui,Roboto,sans-serif;margin:0;background:#111;color:#ddd}")
         .append("header{padding:14px 18px;background:").append(allOk ? "#1b5e20" : "#7f1d1d").append(";color:#fff}")
         .append("h1{margin:0;font-size:20px}h1 small{font-weight:normal;opacity:.8;font-size:13px;margin-left:10px}")
         .append("main{padding:12px 18px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}")
         .append("section{background:#1c1c1c;border:1px solid #2a2a2a;border-radius:8px;padding:12px 14px}")
         .append("h2{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#9aa}")
         .append("table{border-collapse:collapse;width:100%}td{padding:3px 0;vertical-align:top}td:first-child{color:#9aa;width:44%}")
         .append(".ok{color:#4ade80}.bad{color:#f87171;font-weight:600}.warn{color:#fbbf24}")
         .append("pre{margin:0;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:340px;overflow:auto;color:#bbb}")
         .append("a{color:#7dd3fc}.links a{margin-right:14px}")
         .append("</style></head><body>");

        h.append("<header><h1>Piano Bridge ").append(allOk ? "✓ healthy" : "✗ needs attention")
         .append("<small>").append(esc(ipAddress())).append(" · shell v").append(core.getShell().shellVersionCode())
         .append(" · payload ").append(esc(payload == null ? "?" : payload.optString("activeVersion", "?")))
         .append(" · ").append(esc(s(time, "iso"))).append("</small></h1></header><main>");

        // ── Link (the thing the piano needs) ──
        sec(h, "MIDI link");
        row(h, "BLE piano", bleState + (ble != null ? " · " + ble.optString("connectedName", "") + " · up " + ble.optLong("connectedSeconds", 0) + "s · reconnects " + ble.optInt("reconnects", 0) : ""), bleOk);
        row(h, "MIDI in (piano→screen)", inOk ? "open" : "CLOSED", inOk);
        row(h, "MIDI out (screen→piano)", writeOk ? "open" : "CLOSED — " + n(core.getMidiWriteLastError()), writeOk);
        row(h, "Last error", ble == null ? "—" : n(ble.optString("lastError", null)), true);
        end(h);

        // ── Kiosk ──
        sec(h, "Kiosk");
        row(h, "Fully Kiosk REST", fkbOk ? "reachable" : "UNREACHABLE — " + (fkb == null ? "?" : fkb.optString("error", "")), fkbOk);
        row(h, "Page", verdict + (webview != null ? " · " + webview.optInt("lastFps", -1) + " fps · beat " + ago(webview.optLong("lastBeatAgoMs", -1)) : ""), pageOk);
        row(h, "Settings guard", s(guard, "verdict"), guard != null && !"UNREACHABLE".equals(guard.optString("verdict")));
        row(h, "Accessibility svc", a11y ? "bound" : "NOT bound", a11y);
        row(h, "Speaker (A2DP)", speaker == null ? "—" : (speaker.optBoolean("connected") ? "connected" : "disconnected") + " · " + speaker.optString("targetName", ""), speaker == null || speaker.optBoolean("connected"));
        if (webview != null) row(h, "Last recovery", n(webview.optString("lastAction", null)) + " → " + n(webview.optString("lastOutcome", null)), true);
        end(h);

        // ── Heartbeat / payload ──
        sec(h, "Heartbeat & payload");
        row(h, "Heartbeat", beat == null ? "NOT RUNNING" : "seq " + beat.optLong("seq") + " · last ok " + ago(beat.optLong("lastOkAgoMs", -1)) + " · every " + beat.optLong("intervalMs") / 1000 + "s", beatOk);
        if (beat != null) row(h, "Sink failures", String.valueOf(beat.optJSONObject("failures")), beat.optJSONObject("failures") == null || beat.optJSONObject("failures").optInt("logStore") == 0);
        if (payload != null) {
            row(h, "Active", payload.optString("active", "?") + " (" + payload.optString("activeVersion", "?") + ")", true);
            row(h, "Previous (rollback)", n(payload.optString("previous", null)), true);
            row(h, "Boots this payload", payload.optInt("bootsThisPayload") + " / " + payload.optInt("crashLimit") + " in " + payload.optLong("crashWindowMs") / 60000 + " min", payload.optInt("bootsThisPayload") < payload.optInt("crashLimit"));
            row(h, "Loader error", n(payload.optString("lastError", null)), payload.isNull("lastError"));
        }
        end(h);

        // ── Device ──
        sec(h, "Device");
        row(h, "IP", ipAddress(), true);
        row(h, "Uptime", time == null ? "—" : dur(time.optLong("uptimeMs")), true);
        row(h, "Time", s(time, "iso") + " " + s(time, "timezone"), true);
        if (dev != null) {
            row(h, "Battery", dev.optString("batteryPct", dev.optString("battery", "—")) + (dev.has("plugged") ? (dev.optBoolean("plugged") ? " · plugged" : " · ON BATTERY") : ""), !dev.has("plugged") || dev.optBoolean("plugged"));
            row(h, "Screen", dev.optString("screen", dev.optString("interactive", "—")), true);
        }
        row(h, "CPU (bridge)", cpu == null ? "—" : cpu.optInt("processCpuPct") + "% · " + cpu.optInt("threadCount") + " threads", true);
        if (thermal != null) row(h, "Thermal", thermal.optInt("readableZones") + " zones" + (thermal.has("maxC") ? " · max " + thermal.opt("maxC") + "°C" : ""), true);
        JSONObject crash = d.optJSONObject("crash");
        if (crash != null) row(h, "Last death", crash.optBoolean("prevDeathUnclean") ? "UNCLEAN (crash/kill/reboot)" : "clean", !crash.optBoolean("prevDeathUnclean"));
        end(h);

        // ── Recent events ──
        h.append("<section style='grid-column:1/-1'><h2>Recent events (in-memory ring)</h2><pre>");
        JSONArray ring = Diag.recent();
        int from = Math.max(0, ring.length() - 60);
        for (int i = from; i < ring.length(); i++) h.append(esc(ring.optString(i))).append('\n');
        h.append("</pre></section>");

        h.append("<section style='grid-column:1/-1' class=links><h2>Raw</h2>")
         .append("<a href=/status>/status</a><a href=/diagnostics>/diagnostics</a><a href=/payload>/payload</a><a href=/beat>/beat</a><a href=/kiosk>/kiosk</a><a href=/log>/log</a><a href=/help>/help</a>")
         .append("<a href='http://").append(esc(ipAddress().split(" ")[0])).append(":8771/'>shell lifeline :8771</a></section>");

        h.append("</main></body></html>");
        return h.toString();
    }

    // ── tiny helpers ──
    private static void sec(StringBuilder h, String title) { h.append("<section><h2>").append(esc(title)).append("</h2><table>"); }
    private static void end(StringBuilder h) { h.append("</table></section>"); }
    private static void row(StringBuilder h, String k, String v, boolean ok) {
        h.append("<tr><td>").append(esc(k)).append("</td><td class=").append(ok ? "ok" : "bad").append(">").append(esc(v)).append("</td></tr>");
    }
    private static String s(JSONObject o, String k) { return o == null ? "—" : o.optString(k, "—"); }
    private static String n(String v) { return v == null || v.isEmpty() || "null".equals(v) ? "—" : v; }
    private static String ago(long ms) { return ms < 0 ? "never" : ms < 1000 ? ms + "ms ago" : ms < 120_000 ? (ms / 1000) + "s ago" : (ms / 60_000) + "m ago"; }
    private static String dur(long ms) { long s = ms / 1000; return s < 3600 ? (s / 60) + "m" : s < 86400 ? (s / 3600) + "h " + (s % 3600) / 60 + "m" : (s / 86400) + "d " + (s % 86400) / 3600 + "h"; }
    static String esc(String v) {
        if (v == null) return "";
        return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
