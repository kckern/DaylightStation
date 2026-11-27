package net.kckern.daylight.cap.notifications.shell;

import org.json.JSONObject;

/**
 * What the link activity does with the payload's answer (the shape is documented on
 * net.kckern.daylight.core.LinkEffect). Pure. There are three things it can do: nothing,
 * bring this app's own window to the front, or show a short message. An answer names
 * one of them and can carry nothing to start or open, and an effect this installed
 * shell does not know does nothing.
 */
final class LinkAnswer {
    enum Kind { NONE, FRONT, TOAST }

    static final String NOT_READY = "Daylight is still starting. Try again in a moment.";
    private static final String FAILED = "That did not work";
    private static final int MAX_MESSAGE = 200;

    final Kind kind;
    final String message;

    private LinkAnswer(Kind kind, String message) {
        this.kind = kind;
        this.message = message;
    }

    /** The fallback when no payload answered within the wait (the loader's own start deadline). */
    static LinkAnswer notReady() { return new LinkAnswer(Kind.TOAST, NOT_READY); }

    /** The loader gave up: no payload will answer until the app is opened again. */
    static LinkAnswer failedToStart() { return new LinkAnswer(Kind.TOAST, net.kckern.daylight.shellkit.PayloadReady.FAILED_WORDS); }

    static LinkAnswer of(String json) {
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (Exception notAnAnswer) {
            return notReady();
        }
        if (!o.optBoolean("ok", false)) return new LinkAnswer(Kind.TOAST, cut(o.optString("message", ""), FAILED));
        String effect = o.optString("effect", "none");
        if ("front".equals(effect)) return new LinkAnswer(Kind.FRONT, "");
        if ("toast".equals(effect)) return new LinkAnswer(Kind.TOAST, cut(o.optString("message", ""), ""));
        return new LinkAnswer(Kind.NONE, "");
    }

    private static String cut(String message, String whenEmpty) {
        if (message == null || message.isEmpty()) return whenEmpty;
        return message.length() > MAX_MESSAGE ? message.substring(0, MAX_MESSAGE) : message;
    }
}
