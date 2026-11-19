package net.kckern.daylight.core;

import org.json.JSONException;
import org.json.JSONObject;

/** The reply shapes of the old helper servers, kept so ported routes answer as before. */
public final class Replies {
    private Replies() { }

    public static JSONObject ok() {
        try { return new JSONObject().put("ok", true); } catch (JSONException e) { return new JSONObject(); }
    }

    public static JSONObject err(String message) {
        try { return new JSONObject().put("ok", false).put("error", message == null ? "" : message); }
        catch (JSONException e) { return new JSONObject(); }
    }

    public static Router.Response json(JSONObject body) { return Router.Response.json(200, body); }

    public static int intParam(Router.Request req, String key, int fallback) {
        String v = req.query.get(key);
        if (v == null) return fallback;
        try { return Integer.parseInt(v); } catch (NumberFormatException e) { return fallback; }
    }

    public static String strParam(Router.Request req, String key, String fallback) {
        String v = req.query.get(key);
        return v == null || v.isEmpty() ? fallback : v;
    }
}
