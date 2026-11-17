package net.kckern.daylight.cap.notifications.shell;

import org.json.JSONObject;

import java.util.Locale;

/**
 * What the link activity takes from an incoming intent. Pure: no Android types. The
 * activity is exported, so the intent can come from any app. Only two things are read
 * from it, the action and the data URI as text. Extras, flags, the component and the
 * clip are never read. The payload decides whether the link is allowed; this only
 * drops what could never be one, so the payload is not asked at all.
 */
final class LinkRequest {
    private static final String VIEW = "android.intent.action.VIEW";
    private static final int MAX_LENGTH = 4096;

    private LinkRequest() { }

    /** The link text to hand to the payload, or null to do nothing. */
    static String accept(String action, String data) {
        if (!VIEW.equals(action) || data == null || data.isEmpty() || data.length() > MAX_LENGTH) return null;
        String lower = data.toLowerCase(Locale.ROOT);
        if (lower.startsWith("daylight://") || lower.startsWith("https://") || lower.startsWith("http://")) return data;
        return null;
    }

    /** The request the "links" port takes. */
    static String body(String link) {
        try {
            return new JSONObject().put("uri", link).toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
