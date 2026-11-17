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
    private boolean prepared;

    public CoreRuntime(ShellServices shell, String deviceId, String payloadVersion, File stateDir) {
        this.shell = shell;
        this.deviceId = deviceId;
        this.payloadVersion = payloadVersion;
        this.auth = new Auth(shell.controlToken());
        this.router = new Router(auth);
        this.components = new Components(shell);
        this.socket = new SocketHub(deviceId, status);
        this.settings = new SettingsRegistry(new File(stateDir, "settings-overrides.json"));
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
    public Auth auth() { return auth; }

    /** Called by the payload entry class when the shell binds or unbinds a component. */
    public void onShellComponent(String name, Object instance) { components.dispatch(name, instance); }

    public void add(Capability capability) { capabilities.add(capability); }

    /** Register every capability and apply the device defaults. Touches no hardware. */
    public synchronized void prepare(JSONObject defaults) {
        if (prepared) return;
        registerCoreRoutes();
        for (Capability c : capabilities) c.register(this);
        settings.applyDefaults(defaults);
        prepared = true;
    }

    /** Register everything, apply device defaults, then start. Throws when the payload cannot run. */
    public void start(JSONObject defaults) {
        prepare(defaults);
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
        for (int i = started.size() - 1; i >= 0; i--) {
            try { started.get(i).stop(); } catch (Throwable ignored) { }
        }
        started.clear();
        socket.stop();
    }

    private void registerCoreRoutes() {
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
            return Router.Response.json(200, new JSONObject().put("ok", true).put("key", key).put("value", settings.get(key)));
        });
        router.route("DELETE", "/settings", req -> {
            String key = req.query.get("key");
            if (key == null) throw new IllegalArgumentException("query needs 'key'");
            settings.reset(key);
            return Router.Response.json(200, new JSONObject().put("ok", true).put("key", key).put("value", settings.get(key)));
        });
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
        return status.collect(StatusBoard.Surface.STATUS, new JSONObject()
                .put("ok", true)
                .put("device", deviceId)
                .put("payloadVersion", payloadVersion)
                .put("shellVersionCode", shell.shellVersionCode())
                .put("uptimeMs", System.currentTimeMillis() - startedAtMs)
                .put("capabilities", names())
                .put("wsClients", socket.clients())
                .put("payload", payload));
    }
}
