package net.kckern.portalkeys;

import android.util.Log;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;


import fi.iki.elonen.NanoWSD;

/**
 * WebSocket + HTTP control plane, mirroring piano-bridge's ControlServer.
 *
 *   ws://<host>:8771/        → key events pushed to the kiosk SPA: {"key":…,"action":…}
 *   http://<host>:8771/status → JSON for pkctl (INCLUDES serviceBound — see below)
 *   http://<host>:8771/log    → recent events ring buffer
 *   http://<host>:8771/config → GET current (redacted), POST ?key=…&value=… to set
 *
 * Port 8771 sits beside piano-bridge's 8770 so the two never collide if a device ever
 * runs both.
 *
 * `serviceBound` is the first field of /status on purpose. The dominant failure mode
 * for this app is the accessibility grant being dropped by an OS update or reset, and
 * the app CANNOT re-grant itself (the `settings` command is denied to untrusted_app).
 * One HTTP call has to be enough to tell "grant is gone, go run adb" apart from
 * "grant is fine, the SPA isn't listening".
 */
public class ControlServer extends NanoWSD {

    private static final String TAG = PortalKeysService.TAG;
    public static final int PORT = 8771;

    private final EventLog eventLog;
    private final Config config;
    private final StatusProvider statusProvider;

    // CopyOnWriteArrayList rather than a WeakHashMap-backed set: entries are removed
    // explicitly in onClose, and a weak set can have entries cleared by GC MID-ITERATION,
    // which is a ConcurrentModificationException waiting to happen on a key press.
    private final CopyOnWriteArrayList<KeySocket> sockets = new CopyOnWriteArrayList<>();

    // WebSocket sends are socket I/O. onKeyEvent runs on the accessibility service's
    // MAIN thread, and Android's StrictMode kills the process with
    // NetworkOnMainThreadException if you write to a socket there — which is exactly
    // what happened on the first hardware run (crash on the very first volume press).
    // Every send goes through here instead.
    private final ExecutorService sendExecutor = Executors.newSingleThreadExecutor();

    public interface StatusProvider {
        boolean isServiceBound();
        long connectedAtMillis();
        int keysSeen();
        boolean isDisplayOn();
        String fkbLastError();
        String installUpdate(String url);
        String readLogcat(int lines);
    }

    public BtDiag btDiag;
    public PresenceReporter presence;

    public ControlServer(EventLog eventLog, Config config, StatusProvider statusProvider) {
        super(PORT);
        this.eventLog = eventLog;
        this.config = config;
        this.statusProvider = statusProvider;
    }

    // ── WebSocket ────────────────────────────────────────────────────────────

    @Override
    protected WebSocket openWebSocket(IHTTPSession handshake) {
        KeySocket ws = new KeySocket(handshake);
        sockets.add(ws);
        return ws;
    }

    /**
     * Fan a key event out to every connected kiosk.
     *
     * Safe to call from the main/input thread — the actual socket write is handed to
     * sendExecutor. Doing it inline is what crashed the first hardware build.
     */
    public void broadcastKey(String keyName, String action, boolean interactive) {
        final String msg = "{\"type\":\"key\",\"key\":\"" + Json.escape(keyName)
                + "\",\"action\":\"" + Json.escape(action)
                + "\",\"interactive\":" + interactive
                + ",\"ts\":" + System.currentTimeMillis() + "}";
        sendExecutor.execute(new Runnable() {
            @Override public void run() {
                for (KeySocket s : sockets) {
                    try {
                        if (s.isOpen()) s.send(msg);
                        else sockets.remove(s);
                    } catch (IOException e) {
                        Log.w(TAG, "ws-send-failed; dropping client: " + e.getMessage());
                        sockets.remove(s);
                    }
                }
            }
        });
    }

    @Override
    public void stop() {
        sendExecutor.shutdownNow();
        super.stop();
    }

    private class KeySocket extends WebSocket {
        KeySocket(IHTTPSession handshake) { super(handshake); }

        @Override protected void onOpen() {
            eventLog.add("ws-open");
            try {
                send("{\"type\":\"ready\",\"port\":" + PORT + "}");
            } catch (IOException ignored) {}
        }

        @Override protected void onClose(WebSocketFrame.CloseCode code, String reason, boolean initiatedByRemote) {
            sockets.remove(this);
            eventLog.add("ws-close " + reason);
        }

        @Override protected void onMessage(WebSocketFrame message) {
            // Only ping is understood; config changes go over HTTP where pkctl lives.
            if ("ping".equals(message.getTextPayload())) {
                try { send("{\"type\":\"pong\"}"); } catch (IOException ignored) {}
            }
        }

        @Override protected void onPong(WebSocketFrame pong) {}

        @Override protected void onException(IOException exception) {
            Log.w(TAG, "ws-exception: " + exception.getMessage());
        }
    }

    // ── HTTP ─────────────────────────────────────────────────────────────────

    @Override
    protected Response serveHttp(IHTTPSession session) {
        String uri = session.getUri();
        try {
            if ("/status".equals(uri)) return json(status());
            // Hardware truth, asked of the radio rather than inferred from
            // feature flags that disagreed with each other.
            if ("/btdiag".equals(uri)) return json(btDiag == null ? "{}" : btDiag.snapshot());
            if ("/btscan".equals(uri)) {
                if (btDiag == null) return json("{}");
                int ms = 15000;
                try {
                    String v = session.getParms().get("ms");
                    if (v != null) ms = Math.max(1000, Math.min(60000, Integer.parseInt(v)));
                } catch (NumberFormatException ignored) {}
                return json(btDiag.scanLe(ms));
            }
            if ("/presence".equals(uri)) return json(presence == null ? "{}" : presence.toJson());
            if ("/log".equals(uri))    return json(eventLog.toJsonArray());
            if ("/config".equals(uri)) return json(handleConfig(session));
            // ADB-free deploy + diagnosis — see SelfUpdater for why these exist.
            if ("/update".equals(uri)) {
                String url = session.getParms().get("url");
                if (url == null || url.isEmpty()) {
                    return json("{\"error\":\"usage: /update?url=<apk-url>\"}");
                }
                return json("{\"result\":\"" + Json.escape(statusProvider.installUpdate(url)) + "\"}");
            }
            if ("/logcat".equals(uri)) {
                String n = session.getParms().get("lines");
                int lines = 200;
                try {
                    if (n != null) lines = Math.max(1, Math.min(2000, Integer.parseInt(n)));
                } catch (NumberFormatException ignored) { /* keep default */ }
                return newFixedLengthResponse(Response.Status.OK, "text/plain",
                        statusProvider.readLogcat(lines));
            }
        } catch (Exception e) {
            return json("{\"error\":\"" + Json.escape(String.valueOf(e.getMessage())) + "\"}");
        }
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain",
                "portal-keys: try /status /log /config /update /logcat");
    }

    private String status() {
        long connectedAt = statusProvider.connectedAtMillis();
        long uptime = connectedAt > 0 ? (System.currentTimeMillis() - connectedAt) / 1000 : 0;
        int wsCount = sockets.size();
        return "{"
                // Identity FIRST. :8771 (portal-keys) and :8770 (piano-bridge) return
                // similar-shaped JSON, and a bare status blob gives no way to tell which
                // panel answered — easy to read the Portal's state and act on the piano
                // tablet, or vice versa. Never remove these.
                + "\"app\":\"portal-keys\","
                + "\"package\":\"" + Json.escape(BuildConfig.APPLICATION_ID) + "\","
                + "\"version\":\"" + Json.escape(BuildConfig.VERSION_NAME) + "\","
                + "\"versionCode\":" + BuildConfig.VERSION_CODE + ","
                + "\"deviceModel\":\"" + Json.escape(android.os.Build.MODEL) + "\","
                + "\"androidVersion\":\"" + Json.escape(android.os.Build.VERSION.RELEASE) + "\","
                + "\"serviceBound\":" + statusProvider.isServiceBound() + ","
                + "\"uptimeSeconds\":" + uptime + ","
                + "\"keysSeen\":" + statusProvider.keysSeen() + ","
                + "\"displayOn\":" + statusProvider.isDisplayOn() + ","
                + "\"wsClients\":" + wsCount + ","
                + "\"fkbLastError\":" + (statusProvider.fkbLastError() == null
                        ? "null" : "\"" + Json.escape(statusProvider.fkbLastError()) + "\"") + ","
                + "\"config\":" + config.toJsonRedacted()
                + "}";
    }

    private String handleConfig(IHTTPSession session) throws Exception {
        Map<String, String> params = session.getParms();
        String key = params.get("key");
        String value = params.get("value");

        if (key == null) return config.toJsonRedacted();

        // One key per call, never a whole-blob replace — see Config's note on the
        // piano-bridge config clobber.
        if (Config.KEY_SCREEN_TOGGLE_ENABLED.equals(key) || Config.KEY_CONSUME_VOLUME.equals(key)) {
            config.setBoolean(key, "true".equalsIgnoreCase(value));
        } else if (Config.KEY_DOUBLE_PRESS_MS.equals(key)) {
            try {
                int ms = Integer.parseInt(value);
                if (ms < 150 || ms > 2000) {
                    return "{\"error\":\"doublePressMs out of range (150-2000)\"}";
                }
                config.setInt(key, ms);
            } catch (NumberFormatException e) {
                return "{\"error\":\"doublePressMs must be an integer\"}";
            }
        } else if (Config.KEY_GATE_HEARTBEAT_MS.equals(key)) {
            try {
                int ms = Integer.parseInt(value);
                if (ms < 5000 || ms > 600000) {
                    return "{\"error\":\"gateHeartbeatMs out of range (5000-600000)\"}";
                }
                config.setInt(key, ms);
            } catch (NumberFormatException e) {
                return "{\"error\":\"gateHeartbeatMs must be an integer\"}";
            }
        } else if (Config.KEY_GATE_ENDPOINT.equals(key) || Config.KEY_GATE_TOKEN.equals(key)) {
            // Empty IS meaningful here: it disables reporting.
            config.setString(key, value == null ? "" : value);
        } else if (Config.KEY_FKB_HOST.equals(key) || Config.KEY_FKB_PASSWORD.equals(key)) {
            if (value == null || value.isEmpty()) {
                return "{\"error\":\"refusing to set " + Json.escape(key) + " to empty\"}";
            }
            config.setString(key, value);
        } else {
            return "{\"error\":\"unknown key: " + Json.escape(key) + "\"}";
        }
        eventLog.add("config-set " + key);
        return config.toJsonRedacted();
    }

    private Response json(String body) {
        Response r = newFixedLengthResponse(Response.Status.OK, "application/json", body);
        r.addHeader("Access-Control-Allow-Origin", "*");
        return r;
    }
}
