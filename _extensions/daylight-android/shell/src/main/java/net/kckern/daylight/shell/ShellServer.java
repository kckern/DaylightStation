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
 * payload that starts cleanly and then fails to serve (wrong port, a swallowed
 * bind exception, a route that wedges) leaves the process alive, so the crash
 * counter never trips, while the control API is dead. Without a second door that
 * payload could not be rolled back remotely and someone would have to go to the
 * device.
 *
 * The shell knows nothing about what the payload does, only the payload store.
 * Routes:
 *   GET  /  or  /status    shell status (port, versionCode, device, payload status)
 *   GET  /payload          payload status
 *   POST /payload?url=&sha256=   fetch, verify and activate a payload
 *   POST /payload/rollback
 *   GET  /log              tail of shell.log
 *   POST /restart          stop and restart the current payload in place
 *
 * Every request needs the device token (401 otherwise). Refusals carry a real
 * status, decided by {@link LifelineGate}: 503 while the loader is not ready, 405
 * for a non-POST on a POST-only route, 400 for a swap without url and sha256, 404
 * for an unknown route. There is no /exec on purpose: the lifeline keeps the
 * smallest surface that can still recover a device.
 */
public final class ShellServer extends NanoHTTPD {

    private static final String TAG = "Daylight-Lifeline";

    private final ShellService service;
    private final int port;
    private final String token;

    public ShellServer(ShellService service, int port, String token) {
        super(port);
        this.service = service;
        this.port = port;
        this.token = token;
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (!TokenCheck.accepts(token, session.getHeaders().get("x-daylight-token"))) {
            return json(Response.Status.UNAUTHORIZED, err("unauthorized"));
        }
        String uri = session.getUri();
        Method method = session.getMethod();
        try {
            Map<String, java.util.List<String>> p = session.getParameters();
            String url = first(p, "url"), sha = first(p, "sha256");
            LifelineGate.Refusal refusal = LifelineGate.check(uri, service.loaderOrNull() != null,
                    method.name(), url != null, sha != null);
            if (refusal != null) return json(Response.Status.lookup(refusal.status), err(refusal.error));
            switch (uri) {
                case "/":
                case "/status": {
                    JSONObject o = new JSONObject();
                    o.put("ok", true);
                    o.put("shell", true);
                    o.put("port", port);
                    o.put("versionCode", service.versionCode());
                    o.put("device", BuildConfig.DEVICE_ID);
                    PayloadLoader l = service.loaderOrNull();
                    o.put("payload", l == null ? JSONObject.NULL : l.status());
                    return json(o);
                }
                case "/payload": {
                    PayloadLoader l = service.loaderOrNull();
                    if (method == Method.POST) {
                        return json(new JSONObject().put("ok", true).put("result", l.requestSwap(url, sha)));
                    }
                    return json(l.status());
                }
                case "/payload/rollback": {
                    return json(new JSONObject().put("ok", true).put("result", service.loaderOrNull().requestRollback()));
                }
                case "/restart": {
                    return json(new JSONObject().put("ok", true).put("result", service.loaderOrNull().requestRestart()));
                }
                case "/log": {
                    File f = ShellLog.file();
                    if (f == null || !f.isFile()) return text("(no shell.log)");
                    String s = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
                    int n = 8000;
                    return text(s.length() > n ? s.substring(s.length() - n) : s);
                }
                default:
                    return json(Response.Status.NOT_FOUND, err("not_found: " + uri
                            + " — shell routes: / /payload /payload/rollback /restart /log"));
            }
        } catch (Exception e) {
            Log.w(TAG, "shell route " + uri + " failed", e);
            return json(Response.Status.INTERNAL_ERROR, err(e.getClass().getSimpleName() + ": " + e.getMessage()));
        }
    }

    private static String first(Map<String, java.util.List<String>> p, String k) {
        java.util.List<String> v = p.get(k);
        return v == null || v.isEmpty() ? null : v.get(0);
    }

    private static JSONObject err(String m) {
        try { return new JSONObject().put("ok", false).put("error", m); } catch (Exception e) { return new JSONObject(); }
    }

    private Response json(JSONObject o) { return json(Response.Status.OK, o); }

    private Response json(Response.Status st, JSONObject o) {
        Response r = newFixedLengthResponse(st, "application/json", o.toString());
        return r;
    }

    private Response text(String s) {
        return newFixedLengthResponse(Response.Status.OK, "text/plain", s);
    }
}
