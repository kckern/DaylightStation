package net.kckern.daylight.core;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the shell's link activity does after the payload handled a link. This JSON
 * shape is the whole contract between a link handler and that activity:
 *
 *   {"ok":true,"effect":"none"}
 *   {"ok":true,"effect":"front"}                  bring this app's own window to the front
 *   {"ok":true,"effect":"toast","message":"..."}
 *   {"ok":false,"error":"<code>","message":"..."} the link was refused; the message is shown
 *
 * There is no effect that names an activity, an intent or a URL. The link activity is
 * exported, so what it can be made to do is this fixed list and nothing a caller chooses.
 */
public final class LinkEffect {
    private LinkEffect() { }

    public static JSONObject none() throws JSONException {
        return new JSONObject().put("ok", true).put("effect", "none");
    }

    public static JSONObject front() throws JSONException {
        return new JSONObject().put("ok", true).put("effect", "front");
    }

    public static JSONObject toast(String message) throws JSONException {
        return new JSONObject().put("ok", true).put("effect", "toast").put("message", message == null ? "" : message);
    }

    public static JSONObject refused(String code, String message) throws JSONException {
        return new JSONObject().put("ok", false).put("error", code).put("message", message == null ? "" : message);
    }
}
