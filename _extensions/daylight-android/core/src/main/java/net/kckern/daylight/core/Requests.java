package net.kckern.daylight.core;

import org.json.JSONObject;

/** Request helpers shared by route handlers. What they reject becomes HTTP 400 in the router. */
public final class Requests {
    private Requests() { }

    /** The request body as a JSON object; empty when there is none. */
    public static JSONObject body(Router.Request req) {
        if (req.body == null || req.body.trim().isEmpty()) return new JSONObject();
        try { return new JSONObject(req.body); }
        catch (Exception e) { throw new IllegalArgumentException("body must be a JSON object"); }
    }

    /** An integer query parameter held to [min, max]. */
    public static int intQuery(Router.Request req, String key, int fallback, int min, int max) {
        String raw = req.query.get(key);
        if (raw == null) return fallback;
        try { return Math.max(min, Math.min(max, Integer.parseInt(raw.trim()))); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("query '" + key + "' must be an integer"); }
    }
}
