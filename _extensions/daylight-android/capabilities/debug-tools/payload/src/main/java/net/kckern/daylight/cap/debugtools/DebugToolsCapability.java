package net.kckern.daylight.cap.debugtools;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LogEvents;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.SettingsRegistry.Type;
import net.kckern.daylight.core.UnsupportedException;
import net.kckern.daylight.core.spi.KioskSurface;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Remote diagnostics: what an operator needs to see and poke a kiosk without ADB.
 *
 * Every route is behind the device token, like every route of the control API, and
 * that is the only way in: nothing here is offered to the page bridge or registered
 * on the WebSocket. What these routes carry can be private (the page's HTML, a
 * screenshot, a script's result, a command's output), so none of it is written to any
 * log. What is logged is that a tool ran, how long it took and how much it returned;
 * for a shell command, the command and its exit code as well.
 */
public final class DebugToolsCapability implements Capability {
    interface Speech {
        boolean speak(Context context, String text, String locale) throws Exception;
        void shutdown();
    }

    interface Sound {
        boolean play(String url, boolean loop, int stream) throws Exception;
        void stop();
    }

    /** `logcat -d` for the last `lines` lines, as ShellExec reports it. */
    interface LogReader { JSONObject read(int lines); }

    /** Whether this app may read other apps' log lines. */
    interface LogAccess { boolean readsOtherApps(Context context); }

    /** One event to the log store. */
    interface LogStore { void emit(String event, String level, JSONObject data); }

    static final int MAX_SPEAK_CHARS = 4000;
    /** /debug/html returns a whole document, which is often larger than an eval result may be. */
    static final int MAX_HTML_CHARS = 8 * 1024 * 1024;
    static final int MIN_TIMEOUT_MS = 100;
    static final int MAX_TIMEOUT_MS = 60_000;
    private static final byte[] PNG_SIGNATURE = { (byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a };
    private static final String LOCALE = "[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}";

    private CoreContext core;
    private volatile Context context;
    private volatile boolean started;
    private volatile Speech speech;
    private volatile Sound sound;
    private volatile LogReader logReader = lines -> ShellExec.exec(LogFilter.command(lines), 8000);
    private volatile LogAccess logAccess = c -> c != null
            && c.checkSelfPermission("android.permission.READ_LOGS") == PackageManager.PERMISSION_GRANTED;
    private volatile LogStore logStore = LogEvents::emit;
    private final AtomicLong evalIds = new AtomicLong();
    /** How long past the sampling time /debug/fps waits for the page's answer. */
    volatile long fpsGraceMs = 3000;

    void useSpeechForTest(Speech s) { speech = s; }
    void useSoundForTest(Sound s) { sound = s; }
    void useLogsForTest(LogReader reader, LogAccess access) { logReader = reader; logAccess = access; }
    void useLogStoreForTest(LogStore store) { logStore = store; }
    boolean started() { return started; }

    @Override public String name() { return "debug-tools"; }

    private void note(String kind, String m) { if (core.shell() != null) core.shell().note(kind, m); }

    /** The device's own event ring (GET /log). Sizes and outcomes only. */
    private void ring(String line) { core.log().add(line); }

    /** The event ring and the log store. Never for what is on screen. */
    private void record(String event, String level, JSONObject data) {
        ring(event + " " + data);
        try { logStore.emit(event, level, data); } catch (Throwable ignored) { }
    }

    private int integer(String key) { return (Integer) core.settings().get(key); }

    /** A setting another capability declares, or "" when that capability is not in this build. */
    private String foreign(String key) {
        try { return String.valueOf(core.settings().get(key)); }
        catch (SettingsRegistry.UnknownSettingException notInThisBuild) { return ""; }
    }

    /** The live page: 501 when this build has no kiosk, null when the kiosk has no window. */
    private KioskSurface page() {
        KioskSurface s = core.services().require(KioskSurface.class, "webview-host");
        return s.attached() ? s : null;
    }

    private static Router.Response noPage() { return Replies.json(Replies.err("no_kiosk_activity")); }

    /** `timeoutMs` from a body: a whole number in range, or the setting when it is absent. */
    private int timeout(JSONObject body, String settingKey) {
        if (!body.has("timeoutMs")) return integer(settingKey);
        Object raw = body.opt("timeoutMs");
        if (!(raw instanceof Integer) && !(raw instanceof Long)) throw new IllegalArgumentException("'timeoutMs' must be a whole number of milliseconds");
        long ms = ((Number) raw).longValue();
        if (ms < MIN_TIMEOUT_MS || ms > MAX_TIMEOUT_MS) {
            throw new IllegalArgumentException("'timeoutMs' must be from " + MIN_TIMEOUT_MS + " to " + MAX_TIMEOUT_MS);
        }
        return (int) ms;
    }

    private static String text(JSONObject body, String key) {
        Object raw = body.opt(key);
        if (raw == null || raw == JSONObject.NULL) return null;
        if (!(raw instanceof String)) throw new IllegalArgumentException("'" + key + "' must be a string");
        return (String) raw;
    }

    @Override public void register(CoreContext core) {
        this.core = core;
        SettingsRegistry s = core.settings();
        // Off by default. /debug/exec answers 501 until this is true.
        s.declare("debug.execEnabled", Type.BOOLEAN, false);
        s.declare("debug.execTimeoutMs", Type.INTEGER, 10000, SettingsRegistry.range(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));
        s.declare("debug.evalTimeoutMs", Type.INTEGER, 5000, SettingsRegistry.range(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));
        // Origins POST /sound may fetch beyond the ones the kiosk trusts. "*" is any http or https origin.
        s.declare("debug.soundOrigins", Type.STRING, "");
        Router router = core.router();

        router.route("GET", "/debug/info", req -> Router.Response.json(200, Replies.ok()
                .put("device", core.deviceId())
                .put("model", String.valueOf(Build.MODEL))
                .put("sdkInt", Build.VERSION.SDK_INT)
                .put("elapsedRealtimeMs", SystemClock.elapsedRealtime())));

        // The WebView's own drawing. Video surfaces and other apps' windows can be absent.
        router.route("GET", "/debug/screenshot", req -> {
            KioskSurface page = page();
            if (page == null) return noPage();
            byte[] png;
            try {
                png = page.capturePng();
            } catch (Exception e) {
                return Router.Response.error(500, "capture_failed", "message", e.getMessage());
            }
            if (!isPng(png)) return Router.Response.error(500, "capture_failed", "message", "the capture is not a PNG");
            ring("debug.screenshot bytes=" + png.length);
            return new Router.Response(200, "image/png", png);
        });

        router.route("POST", "/debug/eval", req -> {
            JSONObject body = Requests.body(req);
            String js = text(body, "js");
            if (js == null || js.isEmpty()) throw new IllegalArgumentException("body needs 'js'");
            int timeout = timeout(body, "debug.evalTimeoutMs");
            KioskSurface page = page();
            if (page == null) return noPage();
            long t0 = System.currentTimeMillis();
            String outcome = "ok";
            int chars = 0;
            try {
                Object value = evalInPage(page, js, timeout, EvalScript.MAX_RESULT_CHARS, false);
                chars = jsonChars(value);
                return Router.Response.json(200, Replies.ok().put("result", value == null ? JSONObject.NULL : value));
            } catch (TimeoutException e) {
                outcome = "timeout";
                return Router.Response.error(408, "timeout", "message", "the page did not answer in " + timeout + " ms");
            } catch (TooLarge e) {
                outcome = "too_large";
                chars = e.chars;
                return tooLarge(e, EvalScript.MAX_RESULT_CHARS);
            } catch (EvalScript.PageError e) {
                outcome = "js_error";
                return Replies.json(Replies.err("js_error").put("message", e.getMessage()));
            } finally {
                // That an eval ran, how long it took and how much came back. Never the script or its result.
                record("debug.eval", "info", new JSONObject().put("outcome", outcome)
                        .put("ms", System.currentTimeMillis() - t0).put("resultChars", chars));
            }
        });

        router.route("GET", "/debug/html", req -> {
            KioskSurface page = page();
            if (page == null) return noPage();
            int timeout = integer("debug.evalTimeoutMs");
            try {
                Object value = evalInPage(page, "document.documentElement.outerHTML", timeout, MAX_HTML_CHARS, false);
                if (!(value instanceof String)) return Router.Response.error(500, "internal", "message", "the page has no document");
                ring("debug.html chars=" + ((String) value).length());
                return Router.Response.json(200, Replies.ok().put("html", value));
            } catch (TimeoutException e) {
                return Router.Response.error(408, "timeout", "message", "the page did not answer in " + timeout + " ms");
            } catch (TooLarge e) {
                return tooLarge(e, MAX_HTML_CHARS);
            } catch (EvalScript.PageError e) {
                return Replies.json(Replies.err("js_error").put("message", e.getMessage()));
            }
        });

        router.route("GET", "/debug/fps", req -> {
            int ms = Requests.intQuery(req, "ms", 1000, 100, 10_000);
            KioskSurface page = page();
            if (page == null) return noPage();
            long wait = ms + fpsGraceMs;
            try {
                Object value = evalInPage(page, null, wait, EvalScript.MAX_RESULT_CHARS, true, ms);
                JSONObject o = Replies.ok();
                if (value instanceof JSONObject) {
                    JSONObject v = (JSONObject) value;
                    for (Iterator<String> it = v.keys(); it.hasNext(); ) { String k = it.next(); o.put(k, v.get(k)); }
                }
                record("debug.fps", "info", new JSONObject().put("fps", o.opt("fps")).put("frames", o.opt("frames")).put("ms", o.opt("ms")));
                return Router.Response.json(200, o);
            } catch (TimeoutException e) {
                return Router.Response.error(408, "timeout", "message",
                        "no animation frame ran in " + wait + " ms; is the display on and the kiosk in front?");
            } catch (TooLarge | EvalScript.PageError e) {
                return Replies.json(Replies.err("js_error").put("message", String.valueOf(e.getMessage())));
            }
        });

        router.route("POST", "/debug/exec", req -> {
            if (!(Boolean) core.settings().get("debug.execEnabled")) throw new UnsupportedException("debug.execEnabled is false");
            JSONObject body = Requests.body(req);
            String raw = text(body, "cmd");
            String cmd = raw == null ? "" : raw.trim();
            if (cmd.isEmpty()) throw new IllegalArgumentException("body needs 'cmd'");
            int timeout = timeout(body, "debug.execTimeoutMs");
            String shown = cmd.length() > 200 ? cmd.substring(0, 200) + "…" : cmd;
            note("EXEC", shown);                         // every remote command leaves a line, before it runs
            JSONObject r = ShellExec.run(cmd, timeout);    // sh -c, as this app's own uid
            boolean ran = r.optBoolean("ok");
            int exit = r.optInt("exit", -1);
            // The command and how it ended. Never what it printed.
            JSONObject data = new JSONObject().put("cmd", shown).put("exitCode", ran ? (Object) exit : JSONObject.NULL)
                    .put("ms", r.optLong("ms")).put("timedOut", r.optBoolean("timeout", false))
                    .put("from", req.remote == null ? JSONObject.NULL : req.remote);
            ring("debug.exec exit=" + (ran ? String.valueOf(exit) : "none") + " ms=" + r.optLong("ms") + " cmd=" + shown);
            try { logStore.emit("debug.exec", "warn", data); } catch (Throwable ignored) { }
            if (!ran) return Router.Response.error(500, "exec_failed", "message", r.optString("error"));
            return Router.Response.json(200, Replies.ok().put("exitCode", exit)
                    .put("stdout", r.optString("stdout")).put("stderr", r.optString("stderr"))
                    .put("stdoutTruncated", r.optBoolean("stdoutTruncated")).put("stderrTruncated", r.optBoolean("stderrTruncated"))
                    .put("timedOut", r.optBoolean("timeout", false)).put("ms", r.optLong("ms")));
        });

        router.route("GET", "/debug/logcat", req -> {
            int lines = LogFilter.lines(req.query.get("lines"));
            String filter = req.query.get("filter");
            String problem = LogFilter.problem(filter);
            if (problem != null) throw new IllegalArgumentException(problem);
            JSONObject r = logReader.read(lines);
            if (!r.optBoolean("ok")) return Router.Response.error(500, "logcat_failed", "message", r.optString("error"));
            String text = LogFilter.apply(r.optString("stdout"), filter);
            // Other apps' lines need READ_LOGS, granted once over ADB. Without it these are this app's own.
            boolean all = false;
            try { all = logAccess.readsOtherApps(context); } catch (Throwable ignored) { }
            return new Router.Response(200, "text/plain", text.getBytes(StandardCharsets.UTF_8))
                    .withHeader("X-Daylight-Log-Scope", all ? "all" : "own");
        });

        router.route("POST", "/speak", req -> {
            JSONObject body = Requests.body(req);
            String text = text(body, "text");
            if (text == null || text.trim().isEmpty()) throw new IllegalArgumentException("body needs 'text'");
            if (text.length() > MAX_SPEAK_CHARS) throw new IllegalArgumentException("'text' is longer than " + MAX_SPEAK_CHARS + " characters");
            String locale = text(body, "locale");
            if (locale == null) locale = "";
            if (!locale.isEmpty() && !locale.matches(LOCALE)) throw new IllegalArgumentException("'locale' must be a language tag such as en-US");
            Speech engine = speech;
            if (engine == null) throw new UnsupportedException("the payload has no Android context");
            boolean queued = engine.speak(context, text, locale);
            ring("speak chars=" + text.length() + " queued=" + queued);     // never the text
            return Router.Response.json(200, (queued ? Replies.ok() : Replies.err("speak_refused")).put("queued", queued));
        });

        router.route("POST", "/sound", req -> {
            JSONObject body = Requests.body(req);
            if (body.optBoolean("stop", false)) {
                Sound player = sound;
                if (player != null) player.stop();
                return Router.Response.json(200, Replies.ok().put("playing", false));
            }
            String refusal = SoundPolicy.refusal(text(body, "url"), foreign("webview.startUrl"),
                    foreign("webview.bridgeOrigins"), (String) core.settings().get("debug.soundOrigins"));
            if (refusal != null) throw new IllegalArgumentException(refusal);
            int stream = 3;
            if (body.has("stream")) {
                if (!(body.opt("stream") instanceof Integer)) throw new IllegalArgumentException("'stream' must be a whole number");
                stream = body.getInt("stream");
            }
            if (stream < 0 || stream > 10) throw new IllegalArgumentException("stream must be 0..10");
            Sound player = sound;
            if (player == null) throw new UnsupportedException("the payload has no Android context");
            boolean playing = player.play(body.getString("url").trim(), body.optBoolean("loop", false), stream);
            ring("sound playing=" + playing + " stream=" + stream);
            return Router.Response.json(200, (playing ? Replies.ok() : Replies.err("sound_failed")).put("playing", playing));
        });
    }

    /** On the payload loader's worker thread. Takes the context; the engines are made on first use. */
    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        if (ctx == null) return;
        context = ctx;
        if (speech == null) speech = new Speaker();
        if (sound == null) sound = new SoundPlayer();
        started = true;
    }

    /** May be called twice. */
    @Override public void stop() {
        if (!started) return;
        started = false;
        Speech s = speech;
        Sound p = sound;
        speech = null;
        sound = null;
        context = null;
        if (s != null) { try { s.shutdown(); } catch (Throwable ignored) { } }
        if (p != null) { try { p.stop(); } catch (Throwable ignored) { } }
    }

    private static boolean isPng(byte[] bytes) {
        if (bytes == null || bytes.length < PNG_SIGNATURE.length) return false;
        for (int i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] != PNG_SIGNATURE[i]) return false;
        return true;
    }

    /** The length of a value's JSON text, for the log. */
    private static int jsonChars(Object value) {
        if (value == null || value == JSONObject.NULL) return 4;
        return value instanceof String ? JSONObject.quote((String) value).length() : String.valueOf(value).length();
    }

    private static final class TooLarge extends Exception {
        final int chars;
        TooLarge(int chars) { super("the result is " + chars + " characters"); this.chars = chars; }
    }

    private static Router.Response tooLarge(TooLarge e, int max) throws Exception {
        return Router.Response.json(413, Replies.err("result_too_large").put("size", e.chars).put("max", max)
                .put("message", "the result is " + e.chars + " characters of JSON; the limit is " + max));
    }

    private Object evalInPage(KioskSurface surface, String js, long timeoutMs, int maxChars, boolean fps) throws Exception {
        return evalInPage(surface, js, timeoutMs, maxChars, fps, 0);
    }

    /**
     * Run js in the live page (or, for fps, the frame counter) and return its value.
     * A Promise is waited for by polling its parked result. Whatever the outcome, a slot
     * whose result was not read is removed from the page before this returns.
     */
    private Object evalInPage(KioskSurface surface, String js, long timeoutMs, int maxChars, boolean fps, int fpsMs) throws Exception {
        String id = "e" + Long.toString(evalIds.incrementAndGet(), 36);
        long deadline = System.currentTimeMillis() + timeoutMs;
        boolean read = false;
        try {
            String script = fps ? EvalScript.fpsProbe(fpsMs, id) : EvalScript.wrap(js, id, maxChars);
            JSONObject r = EvalScript.parse(surface.evaluate(script, timeoutMs));
            while (r == null || r.has("pending")) {
                long left = deadline - System.currentTimeMillis();
                if (left <= 0) throw new TimeoutException();
                Thread.sleep(Math.min(50, left));
                r = EvalScript.parse(surface.evaluate(EvalScript.poll(id, maxChars), Math.max(100, left)));
            }
            read = true;
            if (r.has("big")) throw new TooLarge(r.optInt("big"));
            if (r.has("e")) throw new EvalScript.PageError(r.getString("e"));
            return r.opt("v");
        } finally {
            if (!read) {
                try { surface.evaluate(EvalScript.cleanup(id), 1000); } catch (Throwable ignored) { }
            }
        }
    }
}
