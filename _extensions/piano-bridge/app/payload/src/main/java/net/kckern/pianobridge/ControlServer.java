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

    private final BridgeCore service;
    private final Set<ControlSocket> clients =
            Collections.newSetFromMap(new ConcurrentHashMap<ControlSocket, Boolean>());
    private final Timer heartbeatTimer = new Timer("PianoBridge-WS-heartbeat", true);

    /** Last loaded preset id, reported in the status heartbeat. */
    private volatile String currentPresetId = null;

    public ControlServer(BridgeCore service) {
        super(PORT);
        this.service = service;
    }

    @Override
    public void start(int timeout, boolean daemon) throws IOException {
        super.start(timeout, daemon);
        Log.i(TAG, "ControlServer listening on port " + PORT);
        heartbeatTimer.scheduleAtFixedRate(new TimerTask() {
            private int tick;
            @Override public void run() {
                broadcastStatus();
                // Server-side keepalive PING every 3s. NanoHTTPD's per-connection READ
                // timeout (~5-8s) only resets on INBOUND bytes; the kiosk sends nothing
                // while idle, so before p12 every WS died with 1006 every ~8s and the
                // page reconnected — ~500 churn cycles/hour, for weeks (log store,
                // context.app:piano _msg:bridge.closed). The browser auto-PONGs a PING,
                // which feeds the read side and keeps the socket up.
                if (++tick % 3 == 0) {
                    for (ControlSocket c : clients) {
                        try { c.ping(new byte[] { 'k', 'a' }); }
                        catch (IOException e) {
                            Log.w(TAG, "keepalive ping failed; dropping client", e);
                            clients.remove(c);
                        }
                    }
                }
            }
        }, 1000L, 1000L);
    }

    @Override
    public void stop() {
        Log.i(TAG, "ControlServer stopping (" + clients.size() + " ws clients)");
        heartbeatTimer.cancel();
        // Close every live WebSocket FIRST. NanoHTTPD's listener thread will not
        // release the port while a connection is open, and the kiosk page always
        // holds one — so on a hot swap the OLD payload's server kept :8770 and the
        // NEW payload's bind silently lost (2026-08-23: p5 loaded, its heartbeat
        // ran, but p4's route table kept answering). Closing the clients is what
        // lets the port actually go.
        for (ControlSocket c : clients) {
            try { c.close(WebSocketFrame.CloseCode.GoingAway, "payload swap", false); }
            catch (Exception e) { Log.w(TAG, "ws close on stop: " + e.getMessage()); }
        }
        clients.clear();
        super.stop();
        // Belt-and-braces: NanoHTTPD.stop() joins the listener; confirm it is gone so
        // the next payload's bind is not racing a socket that is still closing.
        for (int i = 0; i < 20 && isAlive(); i++) {
            try { Thread.sleep(100L); } catch (InterruptedException ignored) { break; }
        }
        Log.i(TAG, "ControlServer stopped, listener alive=" + isAlive());
    }

    /** Which payload built this server — so "who is answering :8770" is never ambiguous. */
    public static final String BUILT_BY = "p19-gatt-latch";

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
            // "/" is the self-reported diagnosis page for a human (phone/laptop browser);
            // curl/pbctl (no text/html Accept) still get the JSON route list.
            if ("/".equals(uri)) {
                String accept = session.getHeaders().getOrDefault("accept", "");
                if (accept.contains("text/html")) {
                    NanoHTTPD.Response r = NanoHTTPD.newFixedLengthResponse(
                            NanoHTTPD.Response.Status.OK, "text/html; charset=utf-8", StatusPage.render(service));
                    return r;
                }
            }
            switch (uri) {
                case "/":
                case "/help":
                    return json(ok().put("routes", new JSONArray()
                            .put("GET /status").put("POST /connect").put("POST /forget")
                            .put("POST /scan?ms=4000").put("GET /config").put("POST /config (yaml body)")
                            .put("GET /                      (HTML status page for a browser; JSON here for curl)")
                            .put("GET /log").put("POST /panic")
                            .put("GET|POST /beat               (outbound heartbeat state / send one now)")
                            .put("GET|POST /loopback           (OUT assertion via piano ECHO: probe+wait / rolling state)")
                            .put("POST /reset                 (FORCE-RESET the BLE link, escalate to radio bounce, verify by echo)")
                            .put("GET /midi/tap               (raw bytes the read port delivered; running-status count)")
                            .put("GET|POST /midi/send?hex=F0…F7&repeat=3  (raw MIDI/SysEx OUT to the piano)")
                            .put("GET /diagnostics            (FULL system+FKB health snapshot for `pbctl diag`)")
                            .put("GET /kiosk                  (WebView watchdog verdict + recovery counters)")
                            .put("POST /kiosk/beat            (page heartbeat ingest: {fps,visibility,url})")
                            .put("GET /kiosk/settings         (FKB kiosk-settings drift guard: verdict, repairs, disarm)")
                            .put("POST /kiosk/settings/check   (force one drift pass NOW, bypassing the install hold)")
                            .put("POST /kiosk/settings/disarm?minutes=60  (stop repairing drift while fiddling; max 24h)")
                            .put("POST /kiosk/settings/rearm   (re-arm the drift guard now)")
                            .put("GET /crashlog               (durable death/crash + reboot-cap record)")
                            .put("GET|POST /update?url=<apk-url>  (ADB-free self-update; one-tap confirm)")
                            .put("GET /payload                (hot-swap payload status: current/previous/available/boots)")
                            .put("POST /payload?url=<jar-url>&sha256=<hex>  (fetch+verify+activate a new payload; zero-tap)")
                            .put("POST /payload/rollback      (revert to the previous payload)")
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
                    o.put("servedBy", BUILT_BY);
                    Loopback lbs = service.getLoopback();
                    if (lbs != null) o.put("outVerified", lbs.snapshot().optBoolean("outVerified")); // the payload whose ControlServer owns :8770
                    // The write path to the piano. Surfaced because "BLE CONNECTED" says
                    // nothing about whether we can SEND — that gap is exactly what let the
                    // 2026-08-22 one-way outage hide behind a healthy-looking status.
                    JSONObject w = new JSONObject();
                    w.put("open", service.isMidiWriteOpen());
                    String werr = service.getMidiWriteLastError();
                    w.put("lastError", werr == null ? JSONObject.NULL : werr);
                    o.put("midiWrite", w);
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
                case "/kiosk/settings": {
                    KioskSettingsGuard g = service.getKioskSettingsGuard();
                    return json(g != null ? g.snapshot() : err("no_settings_guard"));
                }
                case "/kiosk/settings/check": {
                    // Run one pass NOW, bypassing the install hold — the deploy-time
                    // acceptance test ("break kioskMode, prove the guard fixes it")
                    // without having to edit the hold out of the config and remember to
                    // put it back. Still refused while disarmed/disabled.
                    KioskSettingsGuard g = service.getKioskSettingsGuard();
                    if (g == null) return json(err("no_settings_guard"));
                    return json(g.forceCheck());
                }
                case "/kiosk/settings/disarm": {
                    // Hands-on escape hatch: stop the guard repairing drift while
                    // someone is deliberately fiddling with FKB's settings.
                    KioskSettingsGuard g = service.getKioskSettingsGuard();
                    if (g == null) return json(err("no_settings_guard"));
                    int minutes = parseIntParam(session, "minutes", 60);
                    // Clamp to 24h so a fat-fingered "6000" can't disarm until next year.
                    minutes = Math.max(1, Math.min(24 * 60, minutes));
                    JSONObject r = g.disarmForMinutes(minutes);
                    return json(r.put("minutes", minutes).put("disarmUntilMs", g.disarmUntilMs()));
                }
                case "/touch": {
                    // Fire N synthetic swipes via the a11y service — the jank A/B probe.
                    // Exists to answer the question performance.md left OPEN: does an
                    // accessibility-INJECTED gesture lift the SM-T590's input-recency frame
                    // throttle the way a finger does? Read /kiosk lastFps before and after.
                    if (method != NanoHTTPD.Method.POST) return json(err("POST only"));
                    int count = Math.max(1, Math.min(30, parseIntParam(session, "count", 6)));
                    boolean bound = A11y.isConnected();
                    if (bound) TouchPulser.burst(service.getConfig(), count);
                    JSONObject o = ok();
                    o.put("a11yBound", bound);
                    o.put("requested", bound ? count : 0);
                    if (!bound) o.put("note", "a11y service not bound — nothing dispatched");
                    return json(o);
                }
                case "/midi/tap": {
                    // Raw bytes the read port handed the receiver (last 64 chunks) + how
                    // often running status was used. THE witness for "did the parser get it".
                    return json(ok().put("tap", service.midiInTapSnapshot()));
                }
                case "/reset": {
                    // FORCE-RESET the MIDI link and PROVE the result. The browser's
                    // "reload MIDI" only re-acquires Chrome's Web MIDI handle — it never
                    // touches the APK's BLE connection, which is what goes zombie, which
                    // is why that button never fixed anything. This escalates the layer
                    // that actually matters and verifies with the piano's echo:
                    //   L1  forget + reconnect the BLE device, re-probe
                    //   L2  if still no echo, bounce the tablet's Bluetooth radio, reconnect, re-probe
                    // Returns the loopback verdict at the end, so the caller (and the
                    // Operator drawer) can show "fixed" or "still down" HONESTLY.
                    if (method != NanoHTTPD.Method.POST) return json(err("POST only"));
                    Diag.log(TAG, "/reset from " + session.getRemoteIpAddress());
                    JSONObject o = service.forceResetLink();
                    return json(o);
                }
                case "/loopback": {
                    // The conclusive OUT assertion: send an inaudible probe note and wait
                    // for the PIANO to echo it back. POST = probe now and block for the
                    // verdict; GET = rolling state. See Loopback.java.
                    Loopback lb = service.getLoopback();
                    if (lb == null) return json(err("loopback not started"));
                    if (method == NanoHTTPD.Method.POST) return json(lb.probeAndWait());
                    return json(ok().put("loopback", lb.snapshot()));
                }
                case "/tone": {
                    // ONE-WORD audible smoke test: CC7 volume max on ch1, middle C at full
                    // velocity for ~700ms, note-off, then a loopback probe so the response
                    // carries a DELIVERY verdict alongside "did you hear it". Exists because
                    // hand-rolling the three /midi/send calls was fumbled once (2026-08-23:
                    // wrong param name, silent miss). `pbctl tone` is the client.
                    //   POST /tone[?note=60][&velocity=127][&ms=700]
                    if (method != NanoHTTPD.Method.POST) return json(err("POST only"));
                    int note = Math.max(0, Math.min(127, parseIntParam(session, "note", 60)));
                    int vel = Math.max(1, Math.min(127, parseIntParam(session, "velocity", 127)));
                    int ms = Math.max(50, Math.min(5000, parseIntParam(session, "ms", 700)));
                    boolean vOk = service.sendMidi(new byte[] { (byte) 0xB0, 0x07, 0x7F });
                    boolean onOk = service.sendMidi(new byte[] { (byte) 0x90, (byte) note, (byte) vel });
                    try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
                    boolean offOk = service.sendMidi(new byte[] { (byte) 0x80, (byte) note, 0 });
                    Diag.log(TAG, "/tone " + session.getRemoteIpAddress()
                            + " note=" + note + " vel=" + vel + " ms=" + ms
                            + " sent=" + (vOk && onOk && offOk));
                    JSONObject o = ok().put("note", note).put("velocity", vel).put("ms", ms)
                            .put("sent", vOk && onOk && offOk);
                    Loopback lb2 = service.getLoopback();
                    if (lb2 != null) {
                        JSONObject probe = lb2.probeAndWait();
                        o.put("delivery", probe.optBoolean("echoed")
                                ? "VERIFIED - piano echoed a follow-up probe in " + probe.optLong("rttMs") + "ms"
                                : "UNVERIFIED - no echo; the tone may not have reached the piano");
                        o.put("echoed", probe.optBoolean("echoed"));
                    }
                    o.put("audibility", "delivery is proven by the echo; SOUND still depends on the piano's own volume/headphones");
                    return json(o);
                }
                case "/beat": {
                    // Outbound heartbeat: GET = its state, POST = send one NOW and return
                    // the body that went out (so you can see exactly what the store sees).
                    Heartbeat hb = service.getHeartbeat();
                    if (hb == null) return json(err("heartbeat not started"));
                    if (method == NanoHTTPD.Method.POST) {
                        JSONObject sent = hb.beat();
                        return json(ok().put("sent", sent).put("state", hb.snapshot()));
                    }
                    return json(ok().put("heartbeat", hb.snapshot()));
                }
                case "/reboot": {
                    // FKB-INDEPENDENT device restart (the watchdog's L5 rung, on demand).
                    // Exists because every other reboot path runs through FKB's REST on
                    // :2323, and when THAT is what died there was no lever at all.
                    // Needs the a11y service bound (pbctl a11y-enable) — reports plainly
                    // if it isn't, rather than pretending.
                    if (method != NanoHTTPD.Method.POST) return json(err("POST only"));
                    Diag.log(TAG, "/reboot (a11y) from " + session.getRemoteIpAddress());
                    if (!A11y.isConnected()) {
                        return json(err("a11y service not bound — run: pbctl a11y-enable, then retry"));
                    }
                    CrashLog.recordReboot();
                    CrashLog.note("RECOVERY", "manual /reboot via a11y power dialog");
                    boolean dlg = A11y.powerDialog();
                    boolean clicked = false;
                    if (dlg) {
                        try { Thread.sleep(1500L); } catch (InterruptedException ignored) { }
                        clicked = A11y.clickText("restart") || A11y.clickText("reboot");
                    }
                    JSONObject o = ok();
                    o.put("powerDialog", dlg);
                    o.put("clickedRestart", clicked);
                    if (!clicked) o.put("note", "power dialog " + (dlg ? "raised but no Restart control found" : "refused")
                            + " — device may still be showing the dialog");
                    return json(o);
                }
                case "/kiosk/settings/rearm": {
                    KioskSettingsGuard g = service.getKioskSettingsGuard();
                    if (g == null) return json(err("no_settings_guard"));
                    // Clears BOTH halves; reports ok:false if the persisted half failed,
                    // because a half-cleared rearm re-disarms at the next restart.
                    return json(g.rearm().put("disarmUntilMs", g.disarmUntilMs()));
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
                        DeviceConfig.writeOverride(service.getContext(), body);
                        service.reloadConfigAndReconnect();
                        return json(ok().put("action", "config_saved"));
                    } else {
                        JSONObject o = ok();
                        DeviceConfig cfg = service.getConfig();
                        JSONObject vals = new JSONObject();
                        if (cfg != null) for (Map.Entry<String, String> e : cfg.asMap().entrySet()) vals.put(e.getKey(), e.getValue());
                        o.put("values", vals);
                        o.put("overridePath", DeviceConfig.overrideFile(service.getContext()).getAbsolutePath());
                        o.put("hasOverride", DeviceConfig.overrideFile(service.getContext()).exists());
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
                    // Stamp BEFORE the download: deploy step 4 sets kioskMode=false so
                    // Android's install dialog isn't auto-dismissed, and the kiosk-settings
                    // guard must not "repair" that back to true mid-install and abort it.
                    service.markUpdateRequested();
                    Diag.log(TAG, "/update from " + session.getRemoteIpAddress() + " url=" + url);
                    File staged = new File(service.getContext().getCacheDir(), "update.apk");
                    long bytes = downloadTo(url, staged);
                    Updater.install(service.getContext(), staged);
                    return json(ok().put("action", "update").put("bytes", bytes)
                            .put("note", "tap Update on the device to confirm"));
                }

                case "/payload": {
                    // Hot-swap control plane. The shell (installed APK) owns fetch/verify/
                    // activate/rollback; this route only forwards so the payload never has
                    // to host HTTP in the shell. The swap is asynchronous: GET /payload to
                    // watch it land (and this very server goes away when the swap runs).
                    if (method == NanoHTTPD.Method.POST) {
                        String url = strParam(session, "url", null);
                        String sha = strParam(session, "sha256", null);
                        if (url == null || url.trim().isEmpty()) return json(err("missing url"));
                        if (sha == null || sha.trim().isEmpty()) return json(err("missing sha256"));
                        Diag.log(TAG, "/payload swap from " + session.getRemoteIpAddress() + " url=" + url.trim());
                        String result = service.getShell().requestPayloadSwap(url.trim(), sha.trim());
                        return json(ok().put("action", "payload.swap").put("result", result));
                    }
                    return json(new JSONObject(service.getShell().payloadStatusJson()));
                }
                case "/payload/rollback": {
                    if (method != NanoHTTPD.Method.POST) return json(err("POST only"));
                    Diag.log(TAG, "/payload/rollback from " + session.getRemoteIpAddress());
                    String result = service.getShell().requestPayloadRollback();
                    return json(ok().put("action", "payload.rollback").put("result", result));
                }

                // --- ADB-replacement diagnostics ---------------------------------
                // NOTE the SELinux ceiling on this Knox Android 10: an untrusted_app is
                // DENIED dumpsys (any service), /proc/stat, /proc/loadavg, and every other
                // process's /proc. So other-process CPU is impossible here — it needs adb's
                // shell uid. What works: logcat (READ_LOGS), arbitrary in-sandbox exec, our
                // OWN per-thread CPU (read in-process by ProcStats), and framework-API info.
                case "/midi/send": {
                    // Send raw MIDI to the piano over the APK's BLE write path.
                    //   GET|POST /midi/send?hex=F0 41 10 42 12 40 01 30 04 15 F7[&repeat=3]
                    // Hex may be spaced, comma-separated, or bare. This is the ONLY way
                    // SysEx can reach the piano: the kiosk WebView is permanently denied
                    // Web MIDI SysEx (NotAllowedError on {sysex:true}, Chrome 151), so
                    // reverb/chorus have no browser-side route at all.
                    String hex = strParam(session, "hex", null);
                    if (hex == null) hex = strParam(session, "bytes", null); // alias — ?bytes= was fumbled once
                    if (hex == null && method == NanoHTTPD.Method.POST) hex = readBody(session);
                    if (hex == null || hex.trim().isEmpty()) return json(err("missing hex"));
                    byte[] bytes;
                    try { bytes = parseHexBytes(hex); }
                    catch (IllegalArgumentException e) { return json(err(e.getMessage())); }
                    if (bytes.length == 0) return json(err("no bytes"));
                    // The MDG-400 has no read-back and the JamCorder occasionally drops a
                    // BLE→DIN SysEx message, so repeats are the documented mitigation
                    // (piano/config.yml `effects.resend`). Spaced by more than one BLE
                    // connection interval so each lands in its own packet.
                    int repeat = Math.max(1, Math.min(10, parseIntParam(session, "repeat", 1)));
                    // inMs: schedule the send this many ms from now on the BRIDGE's clock
                    // (p17). This is the audio plane for score/composer/studio playback:
                    // the page dispatches up to its transport lookahead (~400ms) ahead and
                    // the bridge's timer fires on time however janky the WebView is —
                    // replacing Web MIDI's timestamped send() whose zombie handle played
                    // NOTHING while the noteheads lit (2026-08-23 evening).
                    long inMs = Math.max(0, Math.min(30_000, parseIntParam(session, "inMs", 0)));
                    int sent = 0;
                    if (inMs > 0) {
                        if (service.scheduleMidi(bytes, inMs)) sent = repeat = 1;
                    } else {
                        for (int i = 0; i < repeat; i++) {
                            if (i > 0) { try { Thread.sleep(30L); } catch (InterruptedException ignored) { } }
                            if (service.sendMidi(bytes)) sent++;
                        }
                        Diag.log(TAG, "/midi/send " + session.getRemoteIpAddress()
                                + " bytes=" + bytes.length + " repeat=" + repeat + " sent=" + sent);
                    }
                    JSONObject o = ok();
                    if (inMs > 0) o.put("inMs", inMs);
                    o.put("bytes", bytes.length);
                    o.put("repeat", repeat);
                    o.put("sent", sent);
                    o.put("writeOpen", service.isMidiWriteOpen());
                    // Deliberately NOT a delivery claim: send() is fire-and-forget. Confirm
                    // at the far end with the JamCorder's ble.in counter.
                    o.put("note", "handed to the port; confirm delivery via JamCorder ble.in");
                    return json(o);
                }
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
                    return json(DeviceProbe.info(service.getContext()));
                case "/getsetting": {
                    String key = strParam(session, "key", null);
                    if (key == null) return json(err("missing key"));
                    return json(SettingsControl.get(service.getContext(), strParam(session, "ns", "secure"), key));
                }
                case "/setsetting": {
                    // ADB-free `settings put` (WRITE_SECURE_SETTINGS). ns=secure|global|system.
                    String key = strParam(session, "key", null);
                    String value = strParam(session, "value", null);
                    if (key == null || value == null) return json(err("missing key/value"));
                    String ns = strParam(session, "ns", "secure");
                    Diag.log(TAG, "/setsetting " + ns + "." + key + "=" + value
                            + " (from " + session.getRemoteIpAddress() + ")");
                    return json(SettingsControl.put(service.getContext(), ns, key, value));
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

    /**
     * Parse a MIDI byte string: "F0 41 10 F7", "f0,41,10,f7" or "F0411 0F7" all work.
     * Rejects odd-length and non-hex input loudly rather than sending a truncated
     * SysEx — a half-sent SysEx can leave the synth waiting for a terminator.
     */
    static byte[] parseHexBytes(String s) {
        String clean = s.replaceAll("(?i)0x", "").replaceAll("[^0-9a-fA-F]", "");
        if (clean.isEmpty()) return new byte[0];
        if (clean.length() % 2 != 0) {
            throw new IllegalArgumentException("odd number of hex digits (" + clean.length() + ")");
        }
        byte[] out = new byte[clean.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

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

    // --- live MIDI fan-out (called by BridgeCore's MidiReceiver) ---

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
            AudioRouteGuard guard = service.getAudioGuard();
            o.put("speakerOk", guard != null && guard.routeOk());
            o.put("speakerReason", guard != null ? guard.reason() : "no_guard");
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
                case "midi.raw": {
                    // Browser → piano. NOTE the asymmetry with note.on/note.off above:
                    // those drive the APK's INTERNAL synth, this one goes out over BLE to
                    // the real instrument. Accepts {hex:"F0 …"} or {bytes:[240,65,…]}.
                    //
                    // This is what lets the kiosk send SysEx at all — the WebView is
                    // permanently denied Web MIDI SysEx, so effects (reverb/chorus) can
                    // only reach the piano through here.
                    byte[] raw = null;
                    String hex = msg.optString("hex", null);
                    if (hex != null && !hex.isEmpty()) {
                        try { raw = parseHexBytes(hex); }
                        catch (IllegalArgumentException e) { sendError("bad_hex", e.getMessage()); break; }
                    } else {
                        JSONArray arr = msg.optJSONArray("bytes");
                        if (arr != null) {
                            raw = new byte[arr.length()];
                            for (int i = 0; i < arr.length(); i++) raw[i] = (byte) arr.optInt(i, 0);
                        }
                    }
                    if (raw == null || raw.length == 0) { sendError("no_bytes", "midi.raw needs hex or bytes"); break; }
                    int reps = Math.max(1, Math.min(10, msg.optInt("repeat", 1)));
                    boolean okAll = true;
                    for (int i = 0; i < reps; i++) {
                        if (i > 0) { try { Thread.sleep(30L); } catch (InterruptedException ignored) { } }
                        okAll &= service.sendMidi(raw);
                    }
                    if (!okAll) sendError("write_failed", "MIDI write path not open");
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
