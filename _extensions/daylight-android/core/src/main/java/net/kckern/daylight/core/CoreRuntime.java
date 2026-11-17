package net.kckern.daylight.core;

import net.kckern.daylight.api.ShellServices;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Owns the router, the settings and the capabilities for one running payload. */
public final class CoreRuntime implements CoreContext {
    private final ShellServices shell;
    private final String deviceId;
    private final String payloadVersion;
    private final Router router;
    private final SettingsRegistry settings;
    private final List<Capability> capabilities = new ArrayList<>();
    private final List<Capability> started = new ArrayList<>();
    private final long startedAtMs = System.currentTimeMillis();
    private final ServiceRegistry services = new ServiceRegistry();
    private final Components components;
    private final StatusBoard status = new StatusBoard();
    private final NoteBus notes = new NoteBus();
    private final EventLog log = new EventLog();
    private final Auth auth;
    private final SocketHub socket;
    private final AccessibilityHub accessibility = new AccessibilityHub();
    private final CoreConfig config;
    /** The context-bound services. Null in JVM tests and whenever the payload is not started. */
    private volatile CoreServices device;
    private boolean prepared;
    /** idle, downloading, awaiting_confirmation or failed. */
    private volatile String updateState = "idle";
    private volatile String updateError;
    private volatile long lastUpdateRequestAtMs;

    public CoreRuntime(ShellServices shell, String deviceId, String payloadVersion, File stateDir) {
        this.shell = shell;
        this.deviceId = deviceId;
        this.payloadVersion = payloadVersion;
        this.auth = new Auth(shell.controlToken());
        this.router = new Router(auth);
        this.components = new Components(shell);
        this.socket = new SocketHub(deviceId, status);
        this.settings = new SettingsRegistry(new File(stateDir, "settings-overrides.json"));
        this.config = new CoreConfig(settings, deviceId);
    }

    @Override public ShellServices shell() { return shell; }
    @Override public Router router() { return router; }
    @Override public SettingsRegistry settings() { return settings; }
    @Override public String deviceId() { return deviceId; }
    @Override public ServiceRegistry services() { return services; }
    @Override public Components components() { return components; }
    @Override public StatusBoard status() { return status; }
    @Override public NoteBus notes() { return notes; }
    @Override public EventLog log() { return log; }
    @Override public SocketHub socket() { return socket; }
    @Override public AccessibilityHub accessibility() { return accessibility; }
    public Auth auth() { return auth; }
    public CoreConfig config() { return config; }
    /** When POST /update was last asked for. Phase 3's watchdog stands down during an install. */
    public long lastUpdateRequestAtMs() { return lastUpdateRequestAtMs; }

    /** Called by the payload entry class when the shell binds or unbinds a component. */
    public void onShellComponent(String name, Object instance) { components.dispatch(name, instance); }

    public void add(Capability capability) { capabilities.add(capability); }

    /** Register every capability and apply the device defaults. Touches no hardware. */
    public synchronized void prepare(JSONObject defaults) {
        if (prepared) return;
        CoreConfig.declare(settings);
        LogEvents.configure(config);
        status.add(StatusBoard.Surface.HEARTBEAT, "core", o -> {
            CoreServices d = device;
            JSONObject w = d == null ? null : d.wifiLink.compact();
            if (w != null) o.put("wifi", w);
        });
        // The piano bridge re-read thresholds on every config reload. Reads are live now;
        // only the timer period needs a restart.
        settings.onChange(key -> {
            CoreServices d = device;
            if (d == null) return;
            if (key.startsWith("wifi.")) d.wifiLink.updateConfig(config);
            if (key.startsWith("heartbeat.")) d.heartbeat.updateConfig(config);
        });
        registerCoreRoutes();
        for (Capability c : capabilities) c.register(this);
        settings.applyDefaults(defaults);
        components.watch(AccessibilityHub.COMPONENT, accessibility::bind);
        prepared = true;
    }

    /** Register everything, apply device defaults, then start. Throws when the payload cannot run. */
    public void start(JSONObject defaults) {
        prepare(defaults);
        if (shell.context() != null) {
            CoreServices d = new CoreServices(this, config);
            device = d;
            d.start();
        }
        for (Capability c : capabilities) {
            try {
                c.start();
                started.add(c);
            } catch (Throwable e) {
                // Throwable: a missing class or native library is an Error, and it must
                // still stop what already started and fail the payload the same way.
                stop();
                throw new IllegalStateException("capability '" + c.name() + "' cannot start: " + e.getMessage(), e);
            }
        }
        socket.start();
        shell.note("CORE", "started " + payloadVersion + " with " + capabilities.size() + " capabilities");
    }

    public void stop() {
        accessibility.bind(null);
        for (int i = started.size() - 1; i >= 0; i--) {
            try { started.get(i).stop(); } catch (Throwable ignored) { }
        }
        started.clear();
        CoreServices d = device;
        device = null;
        if (d != null) { try { d.stop(); } catch (Throwable ignored) { } }
        socket.stop();
    }

    private void registerCoreRoutes() {
        router.route("GET", "/payload", req -> Replies.json(new JSONObject(shell.payloadStatusJson())));
        router.route("POST", "/payload", req -> {
            // Body {"url","sha256"} per the control API contract; query parameters as pbctl sends them.
            String url = Replies.strParam(req, "url", null);
            String sha = Replies.strParam(req, "sha256", null);
            if (req.body != null && req.body.trim().startsWith("{")) {
                JSONObject body = new JSONObject(req.body);
                if (url == null) url = textOrNull(body, "url");
                if (sha == null) sha = textOrNull(body, "sha256");
            }
            if (url == null) return Replies.json(Replies.err("missing url"));
            if (sha == null) return Replies.json(Replies.err("missing sha256"));
            Diag.log("Daylight-Core", "/payload swap from " + req.remote + " url=" + url.trim());
            return requested("payload.swap", shell.requestPayloadSwap(url.trim(), sha.trim()));
        });
        router.route("POST", "/payload/rollback", req -> {
            Diag.log("Daylight-Core", "/payload/rollback from " + req.remote);
            return requested("payload.rollback", shell.requestPayloadRollback());
        });
        // POST starts an install; GET reports how far it got. Body {"url": "..."} per the
        // control API contract; ?url= and a bare-URL body are still accepted, as pbctl sends them.
        router.route("POST", "/update", req -> {
            String url = Replies.strParam(req, "url", null);
            if (url == null && req.body != null && !req.body.trim().isEmpty()) {
                String b = req.body.trim();
                url = b.startsWith("{") ? textOrNull(new JSONObject(b), "url") : b;
            }
            if (url == null || url.trim().isEmpty()) return Replies.json(Replies.err("missing url"));
            CoreServices d = device;
            if (d == null) return Replies.json(Replies.err("not_ready"));
            url = url.trim();
            lastUpdateRequestAtMs = System.currentTimeMillis();
            Diag.log("Daylight-Core", "/update from " + req.remote + " url=" + url);
            updateError = null;
            updateState = "downloading";
            try {
                File staged = new File(d.ctx.getCacheDir(), "update.apk");
                long bytes = Downloads.to(url, staged);
                if (config.updateAutoConfirm()) d.updateConfirmation.begin();
                Updater.install(d.ctx, staged);
                // The session is committed. Without device owner Android now shows a confirm
                // dialog; the result lands in the shell log (lifeline GET /log), not here.
                updateState = "awaiting_confirmation";
                return Replies.json(Replies.ok().put("action", "update").put("state", updateState).put("bytes", bytes)
                        .put("note", config.updateAutoConfirm() ? "confirming on the device" : "tap Update on the device to confirm"));
            } catch (Exception e) {
                updateState = "failed";
                updateError = e.getClass().getSimpleName() + ": " + e.getMessage();
                return Replies.json(Replies.err(updateError).put("state", updateState));
            }
        });
        router.route("GET", "/update", req -> Replies.json(Replies.ok()
                .put("state", updateState)
                .put("lastError", updateError == null ? JSONObject.NULL : updateError)));
        router.route("POST", "/accessibility/enable", req -> {
            CoreServices d = device;
            if (d == null) return Replies.json(Replies.err("not_ready"));
            String component = new android.content.ComponentName(d.ctx, AccessibilityHub.SERVICE_CLASS).flattenToString();
            return Replies.json(SettingsControl.enableAccessibilityService(d.ctx, component).put("component", component));
        });
        router.route("GET", "/log", req -> Replies.json(Replies.ok()
                .put("log", Diag.recent())
                .put("events", new JSONArray(log.toJsonArray()))));
        router.route("GET", "/crashlog", req -> Replies.json(CrashLog.read()));
        router.route("GET", "/diagnostics", req -> {
            CoreServices d = device;
            return Replies.json(d == null ? Replies.err("not_ready") : SystemDiagnostics.snapshot(d.ctx, status));
        });
        router.route("GET", "/wifi", req -> {
            CoreServices d = device;
            return Replies.json(d == null ? Replies.err("not_ready")
                    : d.wifiLink.snapshot("1".equals(Replies.strParam(req, "fresh", "0"))));
        });
        router.route("GET", "/beat", req -> {
            CoreServices d = device;
            return Replies.json(d == null ? Replies.err("not_ready") : Replies.ok().put("heartbeat", d.heartbeat.snapshot()));
        });
        router.route("POST", "/beat", req -> {
            CoreServices d = device;
            if (d == null) return Replies.json(Replies.err("not_ready"));
            JSONObject sent = d.heartbeat.beat();
            return Replies.json(Replies.ok().put("sent", sent).put("state", d.heartbeat.snapshot()));
        });
        router.route("GET", "/status", req -> Router.Response.json(200, statusBody()));
        router.route("GET", "/capabilities", req -> Router.Response.json(200, new JSONObject()
                .put("ok", true)
                .put("capabilities", names())
                .put("routes", new JSONArray(router.routes()))));
        router.route("GET", "/settings", req -> Router.Response.json(200, new JSONObject()
                .put("ok", true)
                .put("settings", settings.describe())));
        router.route("POST", "/settings", req -> {
            JSONObject body;
            try { body = new JSONObject(req.body == null ? "" : req.body); }
            catch (Exception e) { throw new IllegalArgumentException("body must be JSON with 'key' and 'value'"); }
            if (!body.has("key") || !body.has("value")) throw new IllegalArgumentException("body needs 'key' and 'value'");
            // Android's getString coerces a number to text; a newer org.json throws. Check the type here.
            if (!(body.opt("key") instanceof String)) throw new IllegalArgumentException("'key' must be a string");
            String key = (String) body.opt("key");
            settings.set(key, body.get("value"));
            return Router.Response.json(200, new JSONObject().put("ok", true).put("key", key).put("value", settings.shown(key)));
        });
        router.route("DELETE", "/settings", req -> {
            String key = req.query.get("key");
            if (key == null) throw new IllegalArgumentException("query needs 'key'");
            settings.reset(key);
            return Router.Response.json(200, new JSONObject().put("ok", true).put("key", key).put("value", settings.shown(key)));
        });
    }

    /** A string field of a JSON body, or null when it is absent, null or not a string. */
    private static String textOrNull(JSONObject body, String key) {
        Object v = body.opt(key);
        return v instanceof String ? (String) v : null;
    }

    /** The shell's answer to a swap or rollback: 200 when it took the request, 409 with the reason when it refused. */
    private static Router.Response requested(String action, String result) throws Exception {
        if (result == null || result.startsWith("refused")) {
            return Router.Response.json(409, Replies.err(String.valueOf(result)).put("action", action).put("result", String.valueOf(result)));
        }
        return Replies.json(Replies.ok().put("action", action).put("result", result));
    }

    private boolean batteryOptExempt(CoreServices d) {
        try {
            android.os.PowerManager pm = (android.os.PowerManager) d.ctx.getSystemService(android.content.Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(d.ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    private JSONArray names() {
        JSONArray a = new JSONArray();
        for (Capability c : capabilities) a.put(c.name());
        return a;
    }

    /** The core's own fields, then whatever capabilities contribute to the STATUS surface. */
    private JSONObject statusBody() throws Exception {
        // The shell's payload status is extra detail. If it is not JSON, /status still answers.
        Object payload = JSONObject.NULL;
        try { payload = new JSONObject(shell.payloadStatusJson()); } catch (Exception notJson) { }
        // Identity first, so two devices' answers cannot be confused.
        JSONObject body = new JSONObject()
                .put("ok", true)
                .put("device", deviceId)
                .put("model", String.valueOf(android.os.Build.MODEL))
                .put("android", String.valueOf(android.os.Build.VERSION.RELEASE));
        CoreServices d = device;
        if (d != null) {
            body.put("package", d.ctx.getPackageName());
            body.put("batteryOptExempt", batteryOptExempt(d));
        }
        return status.collect(StatusBoard.Surface.STATUS, body
                .put("payloadVersion", payloadVersion)
                .put("shellVersionCode", shell.shellVersionCode())
                .put("uptimeMs", System.currentTimeMillis() - startedAtMs)
                .put("capabilities", names())
                .put("wsClients", socket.clients())
                .put("a11yBound", accessibility.isBound())
                .put("payload", payload));
    }
}
