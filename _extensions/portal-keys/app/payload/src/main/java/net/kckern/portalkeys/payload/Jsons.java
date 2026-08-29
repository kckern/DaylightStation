package net.kckern.portalkeys.payload;

import org.json.JSONArray;
import org.json.JSONObject;

final class Jsons {
    private Jsons() { }

    static JSONObject object(Object... pairs) {
        JSONObject out = new JSONObject();
        for (int i = 0; i + 1 < pairs.length; i += 2) put(out, String.valueOf(pairs[i]), pairs[i + 1]);
        return out;
    }

    static JSONObject put(JSONObject target, String key, Object value) {
        try { target.put(key, value); } catch (Exception ignored) { }
        return target;
    }

    static JSONArray add(JSONArray target, Object value) {
        target.put(value);
        return target;
    }
}
