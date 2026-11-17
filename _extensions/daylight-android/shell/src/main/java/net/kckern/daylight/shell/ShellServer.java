package net.kckern.daylight.shell;

import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * ShellServer is the lifeline: a minimal HTTP server owned by the shell, on the
 * device's lifeline port (passed to the constructor), that stays up regardless of
 * what the payload does.
 *
 * Why it must exist: the payload's control API is the normal control plane. A
 * payload that starts cleanly and then fails to serve (a route that hangs, a
 * listener that died) leaves the process alive, so the crash counter never trips,
 * while the control API is dead. Without a second door that payload could not be
 * rolled back remotely and someone would have to go to the device.
 *
 * The shell knows nothing about what the payload does, only the payload store.
 * Routes:
 *   GET  /  or  /status    shell status (port, versionCode, device, payload status)
 *   GET  /payload          payload status
 *   POST /payload?url=&sha256=   fetch, verify and activate a payload
 *   POST /payload/rollback
 *   GET  /log              tail of shell.log
 *   POST /restart          stop and restart the current payload in place
 *   POST /settings/reset   delete the payload's stored settings overrides, then start the payload
 *
 * The last one is for a stored setting that stops the payload from starting. The
 * control port, where settings are normally changed, is then down, and every payload
 * in the store reads the same overrides file, so a rollback does not help. The shell
 * does not read or edit settings: it removes the one file whose path it shares with
 * the payload through {@link net.kckern.daylight.api.PayloadState}, and the device
 * comes back on its compiled defaults.
 *
 * Every request needs the device token (401 otherwise), checked before anything
 * else. Refusals carry a real status, decided by {@link LifelineGate}: 503 while
 * the loader is not ready, 405 for a non-POST on a POST-only route, 400 for a swap
 * without url and sha256, 409 when the loader refuses the action (no previous
 * payload to roll back to, no current payload to restart, a sha256 that is not 64
 * hex characters), 404 for an unknown route. There is no route that runs
 * commands: the lifeline keeps the smallest surface that can still recover a device.
 *
 * The routing lives in {@link #handle}, which takes and returns plain values so it
 * is tested on the JVM without a socket or an Android Service.
 */
public final class ShellServer extends NanoHTTPD {

    private static final String TAG = "Daylight-Lifeline";
    private static final int LOG_TAIL_CHARS = 8000;

    /** What the lifeline needs from the service that owns it. */
    interface Host {
        PayloadLoader loaderOrNull();
        int versionCode();
    }

    static final class Reply {
        final int status;
        final String contentType;
        final String body;

        Reply(int status, String contentType, String body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }
    }

    private final Host host;
    private final int port;
    private final String token;

    public ShellServer(Host host, int port, String token) {
        this(host, null, port, token);
    }

    private volatile java.net.ServerSocket listening;

    /** The address the lifeline is listening on, or null when it is not listening. */
    java.net.InetAddress boundAddress() {
        java.net.ServerSocket socket = listening;
        return socket == null || !socket.isBound() || socket.isClosed() ? null : socket.getInetAddress();
    }

    /**
     * @param bindHost the address to listen on, or null for every interface. A device
     *                 whose file says `control.bind: loopback` passes the loopback address.
     */
    public ShellServer(Host host, String bindHost, int port, String token) {
        super(bindHost, port);
        setServerSocketFactory(() -> {
            java.net.ServerSocket socket = new java.net.ServerSocket();
            listening = socket;
            return socket;
        });
        this.host = host;
        this.port = port;
        this.token = token;
    }

    @Override
    public Response serve(IHTTPSession session) {
        Map<String, java.util.List<String>> p = session.getParameters();
        Reply r = handle(session.getMethod().name(), session.getUri(),
                session.getHeaders().get("x-daylight-token"), first(p, "url"), first(p, "sha256"));
        Response.IStatus status = Response.Status.lookup(r.status);
        if (status == null) status = Response.Status.INTERNAL_ERROR;
        return newFixedLengthResponse(status, r.contentType, r.body);
    }

    Reply handle(String method, String uri, String presentedToken, String url, String sha) {
        if (!TokenCheck.accepts(token, presentedToken)) return error(401, "unauthorized");
        try {
            PayloadLoader loader = host.loaderOrNull();
            LifelineGate.Refusal refusal = LifelineGate.check(uri, loader != null, method, url != null, sha != null);
            if (refusal != null) return error(refusal.status, refusal.error);
            switch (uri) {
                case "/":
                case "/status": {
                    JSONObject o = new JSONObject();
                    o.put("ok", true);
                    o.put("shell", true);
                    o.put("port", port);
                    o.put("versionCode", host.versionCode());
                    o.put("device", BuildConfig.DEVICE_ID);
                    o.put("payload", loader == null ? JSONObject.NULL : loader.status());
                    return json(200, o);
                }
                case "/payload":
                    if ("POST".equals(method)) return requested(loader.requestSwap(url, sha));
                    return json(200, loader.status());
                case "/payload/rollback":
                    return requested(loader.requestRollback());
                case "/restart":
                    return requested(loader.requestRestart());
                case "/settings/reset":
                    return requested(loader.requestSettingsReset());
                case "/log": {
                    File f = ShellLog.file();
                    if (f == null || !f.isFile()) return new Reply(200, "text/plain", "(no shell.log)");
                    String s = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
                    return new Reply(200, "text/plain", s.length() > LOG_TAIL_CHARS ? s.substring(s.length() - LOG_TAIL_CHARS) : s);
                }
                default:
                    return error(404, "not_found: " + uri + " (shell routes: / /payload /payload/rollback /restart /settings/reset /log)");
            }
        } catch (Exception e) {
            Log.w(TAG, "shell route " + uri + " failed", e);
            return error(500, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** The loader's answer to a swap, rollback or restart: 200 when queued, 409 with the reason when refused. */
    private static Reply requested(String loaderResult) throws Exception {
        LifelineGate.Refusal refusal = LifelineGate.refusalOf(loaderResult);
        if (refusal != null) return error(refusal.status, refusal.error);
        return json(200, new JSONObject().put("ok", true).put("result", loaderResult));
    }

    private static String first(Map<String, java.util.List<String>> p, String k) {
        java.util.List<String> v = p.get(k);
        return v == null || v.isEmpty() ? null : v.get(0);
    }

    private static Reply error(int status, String message) {
        JSONObject o = new JSONObject();
        try { o.put("ok", false).put("error", message); } catch (Exception ignored) { }
        return json(status, o);
    }

    private static Reply json(int status, JSONObject o) { return new Reply(status, "application/json", o.toString()); }
}
