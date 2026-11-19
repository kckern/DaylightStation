package net.kckern.daylight.cap.mediaservice;

import org.json.JSONObject;

final class Json {
    private Json() { }

    /**
     * A string field, or "" when absent, JSON null or not a string or number. Android's
     * optString returns the four letters "null" for a JSON null, and the backend sends
     * many null fields.
     */
    static String str(JSONObject o, String key) {
        if (o == null || o.isNull(key)) return "";
        Object v = o.opt(key);
        return v instanceof String || v instanceof Number ? String.valueOf(v) : "";
    }

    static String first(String... candidates) {
        for (String c : candidates) if (c != null && !c.isEmpty()) return c;
        return "";
    }

    /** A number of seconds as milliseconds; 0 when absent, negative or not a number. */
    static long seconds(JSONObject o, String key) {
        if (o == null) return 0;
        double v = o.optDouble(key, 0);
        if (Double.isNaN(v) || Double.isInfinite(v) || v <= 0) return 0;
        return Math.round(v * 1000);
    }
}
