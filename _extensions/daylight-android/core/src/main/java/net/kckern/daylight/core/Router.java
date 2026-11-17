package net.kckern.daylight.core;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Maps method + path to a handler, behind token auth. Transport-agnostic so it runs in JVM tests. */
public final class Router {
    public interface Handler { Response handle(Request request) throws Exception; }

    public static final class Request {
        public final String method;
        public final String path;
        public final Map<String, String> query;
        /** Request body for POST and PUT, otherwise null. */
        public final String body;
        /** The caller's address as the transport reports it. Null when dispatched without one. */
        public final String remote;

        Request(String method, String path, Map<String, String> query, String body, String remote) {
            this.method = method;
            this.path = path;
            this.query = query;
            this.body = body;
            this.remote = remote;
        }
    }

    public static final class Response {
        public final int status;
        public final String contentType;
        public final byte[] body;

        public Response(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }

        public static Response json(int status, JSONObject body) {
            return new Response(status, "application/json", body.toString().getBytes(StandardCharsets.UTF_8));
        }

        public static Response error(int status, String code, String detailKey, String detail) {
            JSONObject o = new JSONObject();
            try {
                o.put("ok", false).put("error", code);
                if (detail != null) o.put(detailKey, detail);
            } catch (Exception ignored) { }
            return json(status, o);
        }
    }

    private final Auth auth;
    private final Map<String, Handler> handlers = new LinkedHashMap<>();

    public Router(Auth auth) { this.auth = auth; }

    public synchronized void route(String method, String path, Handler handler) {
        String key = method + " " + path;
        if (handlers.containsKey(key)) throw new IllegalStateException("route registered twice: " + key);
        handlers.put(key, handler);
    }

    public synchronized List<String> routes() { return new ArrayList<>(handlers.keySet()); }

    public Response dispatch(String method, String path, String token, Map<String, String> query, String body) {
        return dispatch(method, path, token, query, body, null);
    }

    public Response dispatch(String method, String path, String token, Map<String, String> query, String body, String remote) {
        if (!auth.accepts(token)) return Response.error(401, "unauthorized", "message", null);
        Handler handler;
        boolean pathKnown = false;
        synchronized (this) {
            handler = handlers.get(method + " " + path);
            if (handler == null) {
                for (String key : handlers.keySet()) {
                    if (key.endsWith(" " + path)) { pathKnown = true; break; }
                }
            }
        }
        if (handler == null) {
            return pathKnown
                    ? Response.error(405, "method_not_allowed", "message", method + " " + path)
                    : Response.error(404, "unknown_route", "message", method + " " + path);
        }
        try {
            return handler.handle(new Request(method, path, query, body, remote));
        } catch (UnsupportedException e) {
            return Response.error(501, "unsupported", "reason", e.getMessage());
        } catch (SettingsRegistry.UnknownSettingException e) {
            return Response.error(404, "unknown_setting", "message", e.getMessage());
        } catch (SettingsRegistry.InvalidSettingException e) {
            return Response.error(400, "invalid_setting", "message", e.getMessage());
        } catch (IllegalArgumentException e) {
            return Response.error(400, "bad_request", "message", e.getMessage());
        } catch (Exception e) {
            return Response.error(500, "internal", "message", e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }
}
