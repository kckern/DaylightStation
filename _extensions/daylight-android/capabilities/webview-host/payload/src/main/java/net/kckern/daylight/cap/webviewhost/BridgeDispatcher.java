package net.kckern.daylight.cap.webviewhost;

import org.json.JSONObject;

import java.util.function.Supplier;

/**
 * Every page-to-native call lands here first. Pure Java.
 *
 * addJavascriptInterface exposes the native object to every frame of every page, so a
 * call is honored only with a token issued to the calling document (which only a frame
 * of an allowed origin can ask for, see {@link BridgeTokens}) AND while the main frame is
 * on an allowed origin. A refused call returns "".
 */
final class BridgeDispatcher {
    interface Actions {
        String capabilitiesJson();
        default String piano(String token, String method, String arg) throws Exception { return ""; }
        boolean launch(String json);
        boolean screen(boolean on);
        void restartApp();
        boolean reboot();
        void setBackMode(String mode);
        String volumeJson(int stream);

        /** Whether this build can pin media at all now (MediaPinner present and a launcher that pins). */
        default boolean canPinMedia() { return false; }

        /** MediaPinner.pin: {accepted, reason?}. Only those two fields are passed on to the page. */
        default JSONObject pinMedia(String contentId, String label) { return null; }
    }

    /** The fixed answers of a refused pinMedia; a reason is always one plain word. */
    private static final java.util.regex.Pattern REASON = java.util.regex.Pattern.compile("[a-z_]{1,32}");

    private final BridgeTokens tokens;
    private final OriginPolicy origins;
    private final Supplier<String> mainFrameUrl;
    private final Actions actions;
    private final PinGate pinGate;

    BridgeDispatcher(BridgeTokens tokens, OriginPolicy origins, Supplier<String> mainFrameUrl, Actions actions) {
        this(tokens, origins, mainFrameUrl, actions, new PinGate(System::currentTimeMillis));
    }

    BridgeDispatcher(BridgeTokens tokens, OriginPolicy origins, Supplier<String> mainFrameUrl, Actions actions, PinGate pinGate) {
        this.tokens = tokens;
        this.origins = origins;
        this.mainFrameUrl = mainFrameUrl;
        this.actions = actions;
        this.pinGate = pinGate;
    }

    /** pinMedia requests refused for coming within five seconds of the document's last one. */
    long pinRefusals() { return pinGate.refused(); }

    /**
     * A document opens its session: the key the shim carries buys a token of its own.
     * Refused ("") with a wrong key. The main frame's origin is not asked here: the
     * record of it is written by the main thread when a navigation starts, and a new
     * document's first call can arrive before that. It is asked at every call instead,
     * so a token opened by an allowed-origin frame inside a page of another origin
     * does nothing while that page is the main frame.
     */
    String open(String presentedKey) {
        return tokens.open(presentedKey);
    }

    /** As open(key), with whether the calling document is the top frame ("top") or not. */
    String open(String presentedKey, String frame) {
        return tokens.open(presentedKey, frame);
    }

    String call(String presentedToken, String method, String arg) {
        if (presentedToken == null || method == null) return "";
        // The token must have been issued to the document that is showing now, and the
        // main frame must be on an allowed origin at the moment of the call.
        if (!tokens.valid(presentedToken)) return "";
        if (!origins.allows(mainFrameUrl.get())) return "";
        String a = arg == null ? "" : arg;
        try {
            switch (method) {
                case "pianoSubscribe": case "pianoUnsubscribe": case "pianoRead":
                case "pianoStatus": case "pianoSend": case "pianoRepair": case "pianoRepairResult":
                    if (!tokens.topFrame(presentedToken) || !pianoPath(mainFrameUrl.get())) return "";
                    return actions.piano(presentedToken, method, a);
                case "capabilities": return actions.capabilitiesJson();
                case "launch": return String.valueOf(actions.launch(a));
                case "screen": return String.valueOf(actions.screen("true".equals(a)));
                case "restartApp": actions.restartApp(); return "";
                case "reboot": return String.valueOf(actions.reboot());
                case "setBackMode": if (KeyRouter.validBackMode(a)) actions.setBackMode(a); return "";
                case "volume": return actions.volumeJson(stream(a));
                case "canPinMedia": return String.valueOf(tokens.topFrame(presentedToken) && actions.canPinMedia());
                case "pinMedia": return pinMedia(presentedToken, a);
                default: return "";
            }
        } catch (Throwable t) {
            return "";
        }
    }

    /**
     * The first bridge call that changes something on the phone at a page's request.
     * The token and the origin were checked above. Then: the top frame only, one request
     * per document every five seconds, an object of two strings; the content id and the
     * label are media-service's to check. The answer is {accepted, reason?} built here,
     * so nothing else the native side holds (a link, the key, the pinned list) can reach
     * the page.
     */
    private String pinMedia(String token, String arg) {
        if (!tokens.topFrame(token)) return pinAnswer(false, "not_top_frame");
        if (!pinGate.allow(token)) return pinAnswer(false, "rate_limited");
        String contentId;
        String label;
        try {
            JSONObject request = new JSONObject(arg);
            Object c = request.opt("contentId"), l = request.opt("label");
            if (!(c instanceof String) || !(l instanceof String)) return pinAnswer(false, "bad_request");
            contentId = (String) c;
            label = (String) l;
        } catch (Exception notAnObject) {
            return pinAnswer(false, "bad_request");
        }
        JSONObject answer = actions.pinMedia(contentId, label);
        if (answer == null) return pinAnswer(false, "not_available");
        if (answer.optBoolean("accepted", false)) return pinAnswer(true, null);
        String reason = answer.optString("reason", "");
        return pinAnswer(false, REASON.matcher(reason).matches() ? reason : "failed");
    }

    private static String pinAnswer(boolean accepted, String reason) {
        StringBuilder s = new StringBuilder("{\"accepted\":").append(accepted);
        if (reason != null) s.append(",\"reason\":").append(JSONObject.quote(reason));
        return s.append('}').toString();
    }

    static boolean pianoPath(String url) {
        try {
            String path = java.net.URI.create(url).getRawPath();
            return "/piano".equals(path) || path.startsWith("/piano/");
        } catch (RuntimeException malformed) { return false; }
    }

    private static int stream(String raw) {
        try {
            int s = Integer.parseInt(raw.trim());
            return s >= 0 && s <= 10 ? s : 3;
        } catch (NumberFormatException e) {
            return 3;   // STREAM_MUSIC
        }
    }
}
