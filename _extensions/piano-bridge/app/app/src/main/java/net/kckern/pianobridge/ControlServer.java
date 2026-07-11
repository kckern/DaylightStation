package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.Timer;
import java.util.TimerTask;
import java.util.concurrent.ConcurrentHashMap;

import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoWSD;

/**
 * ControlServer — NanoWSD WebSocket control channel on port 8770.
 *
 * Protocol (MUST match frontend usePianoVoiceBridge.js / instrumentSpec.js):
 *
 *   INBOUND (browser -> APK), JSON text frames keyed by "type":
 *     engine.start                                       -> engine.start()
 *     engine.stop                                        -> engine.stop()
 *     preset.load  { spec: {id,name,engine,asset,patch,
 *                           gain_db,transpose,tune,
 *                           velocity_curve,reverb,eq,chorus} }
 *                                                        -> engine.loadPreset(...)
 *     param.set    { path, value }                       -> engine.setParam(path, value)
 *     panic                                              -> engine.panic()
 *     note.on      { note, velocity }   (RELAY fallback) -> engine.noteOn()
 *     note.off     { note }             (RELAY fallback) -> engine.noteOff()
 *
 *   OUTBOUND (APK -> browser), JSON text frames keyed by "type":
 *     ready                                              (on connect)
 *     status   { engine:"running"|"stopped", preset:<id|null>, cpu:<n>, xruns:<n> }
 *                                                        (~1s heartbeat)
 *     error    { code, msg }                             (on failure)
 *     note.on  { note, velocity }                        (live MIDI fan-out)
 *     note.off { note }                                  (live MIDI fan-out)
 *
 * The browser is the config authority: preset.load ships a fully-resolved spec.
 * note.on/off INBOUND is the relay fallback used when the APK cannot read the
 * BLE-MIDI piano directly; note.on/off OUTBOUND feeds the browser visualizers.
 */
public class ControlServer extends NanoWSD {

    private static final String TAG = "PianoBridge-WS";
    public static final int PORT = 8770;

    private final PianoBridgeService service;
    private final Set<ControlSocket> clients =
            Collections.newSetFromMap(new ConcurrentHashMap<ControlSocket, Boolean>());
    private final Timer heartbeatTimer = new Timer("PianoBridge-WS-heartbeat", true);

    /** Last loaded preset id, reported in the status heartbeat. */
    private volatile String currentPresetId = null;

    public ControlServer(PianoBridgeService service) {
        super(PORT);
        this.service = service;
    }

    @Override
    public void start(int timeout, boolean daemon) throws IOException {
        super.start(timeout, daemon);
        Log.i(TAG, "ControlServer listening on port " + PORT);
        heartbeatTimer.scheduleAtFixedRate(new TimerTask() {
            @Override public void run() { broadcastStatus(); }
        }, 1000L, 1000L);
    }

    @Override
    public void stop() {
        Log.i(TAG, "ControlServer stopping");
        heartbeatTimer.cancel();
        super.stop();
    }

    @Override
    protected WebSocket openWebSocket(IHTTPSession handshake) {
        Log.i(TAG, "Handshake from " + handshake.getRemoteIpAddress());
        return new ControlSocket(handshake);
    }

    // --- HTTP control plane (pbctl CLI) ----------------------------------
    //
    // NanoWSD routes non-WebSocket requests here. Same :8770 socket; NanoHTTPD
    // binds all interfaces, so this is reachable on the LAN (10.0.0.245:8770)
    // for the external pbctl CLI as well as localhost for the kiosk. No auth —
    // LAN kiosk, same trust model as the Fully REST endpoint.

    @Override
    protected NanoHTTPD.Response serveHttp(IHTTPSession session) {
        String uri = session.getUri();
        NanoHTTPD.Method method = session.getMethod();
        try {
            BleMidiConnector ble = service.getBleConnector();
            switch (uri) {
                case "/":
                case "/help":
                    return json(ok().put("routes", new JSONArray()
                            .put("GET /status").put("POST /connect").put("POST /forget")
                            .put("POST /scan?ms=4000").put("GET /config").put("POST /config (yaml body)")
                            .put("GET /log").put("POST /panic")
                            .put("GET /diagnostics            (FULL system+FKB health snapshot for `pbctl diag`)")
                            .put("GET /kiosk                  (WebView watchdog verdict + recovery counters)")
                            .put("POST /kiosk/beat            (page heartbeat ingest: {fps,visibility,url})")
                            .put("GET /crashlog               (durable death/crash + reboot-cap record)")
                            .put("GET|POST /update?url=<apk-url>  (ADB-free self-update; one-tap confirm)")
                            .put("GET /speaker · POST /speaker  (A2DP speaker status+guard / force reconnect)")
                            .put("POST /audio-guard/bootstrap   (spend the one-time clamp window: drop→clamp→reconnect)")
                            .put("POST /audio-guard/override?ms=60000  (reopen SYNTH gate only, time-boxed; never unclamps)")
                            // ADB-replacement diagnostics (untrusted_app sandbox; no other-process CPU):
                            .put("GET|POST /exec?cmd=…[&timeout=10000]  (sh -c as app uid)")
                            .put("GET /cpu?ms=600             (OWN per-thread CPU, in-process)")
                            .put("GET /logcat?lines=200&tag=  (all apps' logs — READ_LOGS)")
                            .put("GET /props?key=             (getprop)")
                            .put("GET /ps                     (own process tree)")
                            .put("GET /info                   (battery/mem/uptime via framework APIs)")
                            .put("GET /getsetting?ns=secure&key=…   (ADB-free settings get)")
                            .put("GET /setsetting?ns=secure&key=&value=…  (WRITE_SECURE_SETTINGS)")));
                case "/status": {
                    JSONObject o = ok();
                    o.put("ble", ble != null ? ble.status() : JSONObject.NULL);
                    A2dpConnector spk = service.getA2dpConnector();
                    o.put("speaker", spk != null ? spk.status() : JSONObject.NULL);
                    o.put("engine", service.isEngineRunning() ? "running" : "stopped");
                    o.put("wsClients", clients.size());
                    o.put("preset", currentPresetId == null ? JSONObject.NULL : currentPresetId);
                    KioskWatchdog wd = service.getKioskWatchdog();
                    if (wd != null) {
                        JSONObject s = wd.snapshot();
                        JSONObject compact = new JSONObject();
                        compact.put("verdict", s.opt("verdict"));
                        compact.put("lastFps", s.opt("lastFps"));
                        compact.put("lastBeatAgoMs", s.opt("lastBeatAgoMs"));
                        compact.put("recovering", s.opt("recovering"));
                        o.put("watchdog", compact);
                    }
                    return json(o);
                }
                case "/diagnostics":
                    // The consolidated "see everything" snapshot: time, cpu, mem, thermal,
                    // battery, bridge, kiosk (WebView watchdog + FKB app), crash record.
                    return json(SystemDiagnostics.snapshot(service));
                case "/kiosk": {
                    KioskWatchdog wd = service.getKioskWatchdog();
                    return json(wd != null ? wd.snapshot() : err("no_watchdog"));
                }
                case "/kiosk/beat": {
                    KioskWatchdog wd = service.getKioskWatchdog();
                    if (wd == null) return json(err("no_watchdog"));
                    String body = readBody(session);
                    if (body != null && !body.trim().isEmpty()) {
                        try { wd.onBeat(new JSONObject(body)); }
                        catch (JSONException je) { return json(err("bad_beat_json")); }
                    }
                    return json(ok());
                }
                case "/crashlog":
                    return json(CrashLog.read());
                case "/speaker": {
                    A2dpConnector spk = service.getA2dpConnector();
                    if (spk == null) return json(err("no_a2dp"));
                    if (method == NanoHTTPD.Method.POST) { spk.connectNow(); return json(ok().put("action", "speaker_connect")); }
                    JSONObject o = ok().put("speaker", spk.status());
                    AudioRouteGuard g = service.getAudioGuard();
                    o.put("guard", g != null ? g.status() : JSONObject.NULL);
                    return json(o);
                }
                case "/audio-guard/bootstrap": {
                    // Spend the one-time exposure window on purpose: drop A2DP, let the
                    // reconciler clamp the speaker index to 0, then reconnect. After this
                    // the speaker is silent permanently (AudioService persists the index).
                    A2dpConnector spk = service.getA2dpConnector();
                    AudioRouteGuard g = service.getAudioGuard();
                    if (spk == null || g == null) return json(err("not_ready"));
                    spk.disconnectNow();
                    Thread.sleep(2500);   // let the route actually fall back to the speaker
                    g.reconcile();        // clamp lands here
                    JSONObject after = g.status();
                    spk.connectNow();
                    return json(ok().put("action", "bootstrap").put("guard", after));
                }
                case "/audio-guard/override": {
                    AudioRouteGuard g = service.getAudioGuard();
                    if (g == null) return json(err("not_ready"));
                    String ms = session.getParms().get("ms");
                    long dur;
                    try { dur = (ms == null) ? 60000L : Long.parseLong(ms); }
                    catch (NumberFormatException nfe) { return json(err("bad_ms")); }
                    dur = Math.min(600000L, Math.max(0L, dur));
                    g.setOverrideUntil(System.currentTimeMillis() + dur);
                    g.reconcile();
                    return json(ok().put("overrideMs", dur).put("guard", g.status()));
                }
                case "/connect":
                    if (ble == null) return json(err("no_connector"));
                    ble.connectNow();
                    return json(ok().put("action", "connect"));
                case "/forget":
                    if (ble == null) return json(err("no_connector"));
                    ble.forget();
                    return json(ok().put("action", "forget"));
                case "/scan": {
                    if (ble == null) return json(err("no_connector"));
                    int ms = parseIntParam(session, "ms", 4000);
                    return json(ok().put("devices", ble.scanForDevices(ms)));
                }
                case "/config":
                    if (method == NanoHTTPD.Method.POST) {
                        String body = readBody(session);
                        if (body == null || body.trim().isEmpty()) return json(err("empty_body"));
                        DeviceConfig.writeOverride(service, body);
                        service.reloadConfigAndReconnect();
                        return json(ok().put("action", "config_saved"));
                    } else {
                        JSONObject o = ok();
                        DeviceConfig cfg = service.getConfig();
                        JSONObject vals = new JSONObject();
                        if (cfg != null) for (Map.Entry<String, String> e : cfg.asMap().entrySet()) vals.put(e.getKey(), e.getValue());
                        o.put("values", vals);
                        o.put("overridePath", DeviceConfig.overrideFile(service).getAbsolutePath());
                        o.put("hasOverride", DeviceConfig.overrideFile(service).exists());
                        return json(o);
                    }
                case "/log":
                    return json(ok().put("log", Diag.recent()));
                case "/panic": {
                    PianoEngine e = service.getEngine();
                    if (e != null) e.panic();
                    return json(ok().put("action", "panic"));
                }
                case "/update": {
                    // ADB-free self-update: fetch a new APK of ourselves from ?url= (or
                    // POST body = url), stage it, and hand to PackageInstaller. On this
                    // Android 10 (no device owner) the user taps one confirm; watch the
                    // result via GET /log. New APK must be same-signed + versionCode >=.
                    String url = strParam(session, "url", null);
                    if (url == null && method == NanoHTTPD.Method.POST) url = readBody(session);
                    if (url == null || url.trim().isEmpty()) return json(err("missing url"));
                    url = url.trim();
                    Diag.log(TAG, "/update from " + session.getRemoteIpAddress() + " url=" + url);
                    File staged = new File(service.getCacheDir(), "update.apk");
                    long bytes = downloadTo(url, staged);
                    Updater.install(service, staged);
                    return json(ok().put("action", "update").put("bytes", bytes)
                            .put("note", "tap Update on the device to confirm"));
                }

                // --- ADB-replacement diagnostics ---------------------------------
                // NOTE the SELinux ceiling on this Knox Android 10: an untrusted_app is
                // DENIED dumpsys (any service), /proc/stat, /proc/loadavg, and every other
                // process's /proc. So other-process CPU is impossible here — it needs adb's
                // shell uid. What works: logcat (READ_LOGS), arbitrary in-sandbox exec, our
                // OWN per-thread CPU (read in-process by ProcStats), and framework-API info.
                case "/exec": {
                    String cmd = strParam(session, "cmd", null);
                    if (cmd == null && method == NanoHTTPD.Method.POST) cmd = readBody(session);
                    if (cmd == null || cmd.trim().isEmpty()) return json(err("missing cmd"));
                    // Audit every remote command into the ring buffer (visible via /log).
                    Diag.log(TAG, "/exec " + session.getRemoteIpAddress() + ": "
                            + (cmd.length() > 200 ? cmd.substring(0, 200) + "…" : cmd));
                    return json(ShellExec.run(cmd, parseIntParam(session, "timeout", 10000)));
                }
                case "/cpu":
                    // Per-THREAD CPU for the bridge's OWN process (synth/BLE/WS/HTTP threads),
                    // sampled in-process. Answers "is the bridge itself spinning, and where".
                    return json(ProcStats.sample(parseIntParam(session, "ms", 600)));
                case "/logcat": {
                    int lines = parseIntParam(session, "lines", 200);
                    String tag = strParam(session, "tag", null);
                    String c = "logcat -d -v time -t " + lines + (tag != null ? " -s " + tag : "");
                    return json(ShellExec.run(c, 8000));
                }
                case "/props":
                    return json(ShellExec.run("getprop " + strParam(session, "key", ""), 5000));
                case "/ps":
                    // Sandbox: shows only our own process tree (hidepid hides the rest).
                    return json(ShellExec.run("ps -A -o PID,TID,USER,%CPU,RSS,NAME 2>/dev/null || ps", 5000));
                case "/info":
                    return json(DeviceProbe.info(service));
                case "/getsetting": {
                    String key = strParam(session, "key", null);
                    if (key == null) return json(err("missing key"));
                    return json(SettingsControl.get(service, strParam(session, "ns", "secure"), key));
                }
                case "/setsetting": {
                    // ADB-free `settings put` (WRITE_SECURE_SETTINGS). ns=secure|global|system.
                    String key = strParam(session, "key", null);
                    String value = strParam(session, "value", null);
                    if (key == null || value == null) return json(err("missing key/value"));
                    String ns = strParam(session, "ns", "secure");
                    Diag.log(TAG, "/setsetting " + ns + "." + key + "=" + value
                            + " (from " + session.getRemoteIpAddress() + ")");
                    return json(SettingsControl.put(service, ns, key, value));
                }

                default:
                    return json(NanoHTTPD.Response.Status.NOT_FOUND, err("not_found").put("uri", uri));
            }
        } catch (Exception e) {
            Log.e(TAG, "HTTP handler error on " + uri, e);
            return json(NanoHTTPD.Response.Status.INTERNAL_ERROR, err(e.getMessage()));
        }
    }

    private JSONObject ok() { try { return new JSONObject().put("ok", true); } catch (JSONException e) { return new JSONObject(); } }
    private JSONObject err(String msg) { try { return new JSONObject().put("ok", false).put("error", msg == null ? "" : msg); } catch (JSONException e) { return new JSONObject(); } }

    private NanoHTTPD.Response json(JSONObject o) { return json(NanoHTTPD.Response.Status.OK, o); }
    private NanoHTTPD.Response json(NanoHTTPD.Response.Status status, JSONObject o) {
        NanoHTTPD.Response r = NanoHTTPD.newFixedLengthResponse(status, "application/json", o.toString());
        r.addHeader("Access-Control-Allow-Origin", "*");
        return r;
    }

    private int parseIntParam(IHTTPSession s, String key, int def) {
        Map<String, java.util.List<String>> p = s.getParameters();
        if (p != null && p.containsKey(key) && !p.get(key).isEmpty()) {
            try { return Integer.parseInt(p.get(key).get(0)); } catch (NumberFormatException ignored) { }
        }
        return def;
    }

    private String strParam(IHTTPSession s, String key, String def) {
        Map<String, java.util.List<String>> p = s.getParameters();
        if (p != null && p.containsKey(key) && !p.get(key).isEmpty()) {
            String v = p.get(key).get(0);
            if (v != null && !v.isEmpty()) return v;
        }
        return def;
    }

    private String readBody(IHTTPSession session) throws IOException {
        int len = 0;
        String cl = session.getHeaders().get("content-length");
        if (cl != null) { try { len = Integer.parseInt(cl.trim()); } catch (NumberFormatException ignored) { } }
        InputStream in = session.getInputStream();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[2048];
        int remaining = len > 0 ? len : Integer.MAX_VALUE;
        int n;
        while (remaining > 0 && (n = in.read(buf, 0, Math.min(buf.length, remaining))) > 0) {
            bos.write(buf, 0, n);
            remaining -= n;
            if (len <= 0 && bos.size() > 65536) break; // safety cap when no content-length
        }
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    /** Download a URL to a file (following redirects); returns the byte count. */
    private long downloadTo(String url, File dest) throws IOException {
        java.net.HttpURLConnection c =
                (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        try (InputStream in = c.getInputStream();
             java.io.FileOutputStream out = new java.io.FileOutputStream(dest)) {
            byte[] buf = new byte[65536];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; }
            out.flush();
            return total;
        } finally {
            c.disconnect();
        }
    }

    // --- live MIDI fan-out (called by PianoBridgeService's MidiReceiver) ---

    /** Forward a live note-on from the BLE-MIDI piano to all connected clients. */
    public void fanOutNoteOn(int note, int velocity) {
        broadcast(buildNote("note.on", note, velocity));
    }

    /** Forward a live note-off from the BLE-MIDI piano to all connected clients. */
    public void fanOutNoteOff(int note) {
        broadcast(buildNote("note.off", note, -1));
    }

    private String buildNote(String type, int note, int velocity) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", type);
            o.put("note", note);
            if (velocity >= 0) o.put("velocity", velocity);
            return o.toString();
        } catch (JSONException e) {
            return null;
        }
    }

    private void broadcastStatus() {
        if (clients.isEmpty()) return;
        try {
            PianoEngine engine = service.getEngine();
            JSONObject o = new JSONObject();
            o.put("type", "status");
            o.put("engine", service.isEngineRunning() ? "running" : "stopped");
            o.put("preset", currentPresetId == null ? JSONObject.NULL : currentPresetId);
            o.put("cpu", engine != null ? engine.cpuLoad() : -1);
            o.put("xruns", engine != null ? engine.xruns() : -1);
            broadcast(o.toString());
        } catch (JSONException e) {
            Log.w(TAG, "status build failed", e);
        }
    }

    private void broadcast(String text) {
        if (text == null) return;
        for (ControlSocket c : clients) {
            try {
                c.send(text);
            } catch (IOException e) {
                Log.w(TAG, "broadcast send failed; dropping client", e);
                clients.remove(c);
            }
        }
    }

    /**
     * Resolve a spec asset path under the instruments dir, guarding against
     * path traversal and absolute paths. Returns the absolute file path, or
     * null if the asset is unsafe / outside the instruments root.
     */
    private String resolveAsset(String asset) {
        if (asset == null || asset.isEmpty()) return null;
        // Reject traversal / absolute / backslash up front (mirrors instrumentSpec.js SAFE()).
        if (asset.contains("..") || asset.startsWith("/") || asset.contains("\\")) {
            Log.e(TAG, "Rejected unsafe asset path: " + asset);
            return null;
        }
        File root = service.getInstrumentsDir();
        File target = new File(root, asset);
        try {
            String rootCanon = root.getCanonicalPath();
            String targetCanon = target.getCanonicalPath();
            // Belt-and-suspenders: canonical path must stay within the root.
            if (!targetCanon.equals(rootCanon) && !targetCanon.startsWith(rootCanon + File.separator)) {
                Log.e(TAG, "Asset escapes instruments root: " + targetCanon);
                return null;
            }
            return targetCanon;
        } catch (IOException e) {
            Log.e(TAG, "Asset canonicalization failed for " + asset, e);
            return null;
        }
    }

    /** One connected control client. */
    private class ControlSocket extends WebSocket {

        ControlSocket(IHTTPSession handshakeRequest) {
            super(handshakeRequest);
        }

        @Override
        protected void onOpen() {
            clients.add(this);
            Log.i(TAG, "Client connected (" + clients.size() + " total)");
            try {
                send(new JSONObject().put("type", "ready").toString());
            } catch (JSONException | IOException e) {
                Log.w(TAG, "failed to send ready", e);
            }
        }

        @Override
        protected void onClose(WebSocketFrame.CloseCode code, String reason, boolean initiatedByRemote) {
            clients.remove(this);
            Log.i(TAG, "Client disconnected: code=" + code + " reason=" + reason
                    + " remote=" + initiatedByRemote + " (" + clients.size() + " left)");
        }

        @Override
        protected void onMessage(WebSocketFrame message) {
            String payload = message.getTextPayload();
            JSONObject msg;
            String type;
            try {
                msg = new JSONObject(payload);
                type = msg.optString("type", "");
            } catch (JSONException e) {
                Log.e(TAG, "Parse error on inbound frame: " + payload, e);
                sendError("bad_json", "could not parse frame");
                return;
            }

            Log.d(TAG, "inbound type=" + type);
            try {
                dispatch(type, msg);
            } catch (Exception e) {
                Log.e(TAG, "dispatch failed for type=" + type, e);
                sendError("dispatch_failed", e.getMessage());
            }
        }

        @Override
        protected void onPong(WebSocketFrame pong) {
            Log.d(TAG, "pong");
        }

        @Override
        protected void onException(IOException exception) {
            Log.e(TAG, "WebSocket exception", exception);
            clients.remove(this);
        }

        private void dispatch(String type, JSONObject msg) {
            PianoEngine engine = service.getEngine();
            switch (type) {
                case "engine.start":
                    service.engineStart();
                    break;
                case "engine.stop":
                    service.engineStop();
                    break;
                case "preset.load": {
                    JSONObject spec = msg.optJSONObject("spec");
                    if (spec == null) { sendError("no_spec", "preset.load missing spec"); break; }
                    handlePresetLoad(spec);
                    break;
                }
                case "param.set": {
                    String path = msg.optString("path", null);
                    if (path == null) { sendError("no_path", "param.set missing path"); break; }
                    float value = (float) msg.optDouble("value", 0.0);
                    if (engine != null) engine.setParam(path, value);
                    break;
                }
                case "panic":
                    if (engine != null) engine.panic();
                    break;
                case "note.on": {
                    // Relay fallback: browser forwards MIDI it read itself.
                    int note = msg.optInt("note", -1);
                    int vel = msg.optInt("velocity", 64);
                    if (note >= 0 && engine != null) engine.noteOn(note, vel);
                    break;
                }
                case "note.off": {
                    int note = msg.optInt("note", -1);
                    if (note >= 0 && engine != null) engine.noteOff(note);
                    break;
                }
                default:
                    Log.w(TAG, "Unknown inbound type: " + type);
                    sendError("unknown_type", "unhandled type: " + type);
            }
        }

        private void handlePresetLoad(JSONObject spec) {
            PianoEngine engine = service.getEngine();
            if (engine == null) { sendError("no_engine", "engine not initialized"); return; }

            String engineName = spec.optString("engine", "");
            String asset = spec.optString("asset", "");
            String resolved = resolveAsset(asset);
            if (resolved == null) {
                sendError("bad_asset", "asset path rejected: " + asset);
                return;
            }
            int patch = spec.optInt("patch", 0);
            float gainDb = (float) spec.optDouble("gain_db", 0.0);
            int transpose = spec.optInt("transpose", 0);
            int tune = spec.optInt("tune", 0);
            String velCurve = spec.optString("velocity_curve", "natural");
            // reverb may be null or an object with a "mix" field.
            float reverbMix = 0f;
            JSONObject reverb = spec.optJSONObject("reverb");
            if (reverb != null) reverbMix = (float) reverb.optDouble("mix", 0.0);

            boolean ok = engine.loadPreset(engineName, resolved, patch, gainDb,
                    transpose, tune, velCurve, reverbMix);
            if (ok) {
                currentPresetId = spec.optString("id", null);
                Log.i(TAG, "preset loaded id=" + currentPresetId + " engine=" + engineName);
            } else {
                sendError("preset_failed", "engine refused preset " + spec.optString("id", "?"));
            }
        }

        private void sendError(String code, String msgText) {
            try {
                JSONObject o = new JSONObject();
                o.put("type", "error");
                o.put("code", code);
                o.put("msg", msgText == null ? "" : msgText);
                send(o.toString());
                Log.w(TAG, "sent error code=" + code + " msg=" + msgText);
            } catch (JSONException | IOException e) {
                Log.e(TAG, "failed to send error frame", e);
            }
        }
    }
}
