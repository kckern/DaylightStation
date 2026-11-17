package net.kckern.daylight.core;

import org.json.JSONObject;

/** JSON string escaping for small fixed-shape payloads, and request helpers shared by route handlers. */
public final class Json {

    private Json() {}

    /** The request body as a JSON object; empty when there is none. A malformed body becomes HTTP 400. */
    public static JSONObject body(Router.Request req) {
        if (req.body == null || req.body.trim().isEmpty()) return new JSONObject();
        try { return new JSONObject(req.body); }
        catch (Exception e) { throw new IllegalArgumentException("body must be a JSON object"); }
    }

    /** An integer query parameter held to [min, max]. Anything that is not an integer becomes HTTP 400. */
    public static int intQuery(Router.Request req, String key, int fallback, int min, int max) {
        String raw = req.query.get(key);
        if (raw == null) return fallback;
        try { return Math.max(min, Math.min(max, Integer.parseInt(raw.trim()))); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("query '" + key + "' must be an integer"); }
    }

    public static String escape(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.toString();
    }
}
