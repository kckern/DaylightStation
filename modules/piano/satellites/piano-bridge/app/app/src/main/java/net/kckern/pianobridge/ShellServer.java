package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * ShellServer — the lifeline. A minimal HTTP server owned by the SHELL, on its own
 * port ({@link #PORT}), that stays up regardless of what the payload does.
 *
 * Why it must exist: the payload's ControlServer on :8770 is the normal control
 * plane, including {@code /payload}. But that means a payload that STARTS cleanly
 * and then fails to serve — wrong port, bind exception swallowed, a route that
 * wedges — leaves the process alive (so the crash counter never trips), :8770 dead,
 * and {@code /payload/rollback} unreachable. That is the one failure the hot-swap
 * design cannot recover from remotely, and it would put a human back at the tablet.
 *
 * So the shell keeps a second door open. It knows nothing about MIDI or kiosks —
 * only the payload store. Routes:
 *   GET  /                 shell status (versionCode, payload status, a11y bound)
 *   GET  /payload          same as the payload's route, served by the shell
 *   POST /payload?url=&sha256=
 *   POST /payload/rollback
 *   GET  /log              tail of shell.log
 *   POST /restart          stop + restart the current payload in place
 *
 * No auth — same LAN-only trust model as :8770. Deliberately no /exec: the lifeline
 * must have the smallest possible surface that can't itself break.
 */
public final class ShellServer extends NanoHTTPD {

    public static final int PORT = 8771;
    private static final String TAG = "PianoBridge-Shell";

    private final PianoBridgeService service;

    public ShellServer(PianoBridgeService service) {
        super(PORT);
        this.service = service;
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();
        try {
            Map<String, java.util.List<String>> p = session.getParameters();
            switch (uri) {
                case "/":
                case "/status": {
                    JSONObject o = new JSONObject();
                    o.put("ok", true);
                    o.put("shell", true);
                    o.put("port", PORT);
                    o.put("versionCode", service.versionCode());
                    o.put("a11yBound", PianoTouchService.current() != null);
                    PayloadLoader l = service.loaderOrNull();
                    o.put("payload", l == null ? JSONObject.NULL : l.status());
                    return json(o);
                }
                case "/payload": {
                    PayloadLoader l = service.loaderOrNull();
                    if (l == null) return json(err("loader not ready"));
                    if (method == Method.POST) {
                        String url = first(p, "url"), sha = first(p, "sha256");
                        if (url == null || sha == null) return json(err("url and sha256 required"));
                        return json(new JSONObject().put("ok", true).put("result", l.requestSwap(url, sha)));
                    }
                    return json(l.status());
                }
                case "/payload/rollback": {
                    PayloadLoader l = service.loaderOrNull();
                    if (l == null) return json(err("loader not ready"));
                    if (method != Method.POST) return json(err("POST only"));
                    return json(new JSONObject().put("ok", true).put("result", l.requestRollback()));
                }
                case "/restart": {
                    PayloadLoader l = service.loaderOrNull();
                    if (l == null) return json(err("loader not ready"));
                    if (method != Method.POST) return json(err("POST only"));
                    return json(new JSONObject().put("ok", true).put("result", l.requestRestart()));
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
        r.addHeader("Access-Control-Allow-Origin", "*");
        return r;
    }

    private Response text(String s) {
        return newFixedLengthResponse(Response.Status.OK, "text/plain", s);
    }
}
