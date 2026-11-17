package net.kckern.daylight.cap.webviewhost;

import org.json.JSONObject;

/**
 * POST /kiosk/overlay, parsed. Pure Java.
 *
 * The text message and the web overlay are two independent layers. A request changes
 * only the layer it names: {text} the message, {url, gravity?} the web overlay, an
 * empty value clears that layer, and a body naming neither clears both. So an arcade
 * session ending ({url:""}) leaves an operator's message where it is.
 */
final class OverlayRequest {
    final boolean setsText;
    final String text;
    final boolean setsWeb;
    final String url;
    /** "top", "bottom" or null. */
    final String gravity;

    private OverlayRequest(boolean setsText, String text, boolean setsWeb, String url, String gravity) {
        this.setsText = setsText;
        this.text = text;
        this.setsWeb = setsWeb;
        this.url = url;
        this.gravity = gravity;
    }

    static OverlayRequest parse(JSONObject body) {
        boolean hasText = body.has("text"), hasUrl = body.has("url");
        if (!hasText && !hasUrl) return new OverlayRequest(true, "", true, "", null);
        String text = null, url = null, gravity = null;
        if (hasText) {
            if (!(body.opt("text") instanceof String)) throw new IllegalArgumentException("'text' must be a string");
            text = (String) body.opt("text");
        }
        if (hasUrl) {
            if (!(body.opt("url") instanceof String)) throw new IllegalArgumentException("'url' must be a string");
            url = ((String) body.opt("url")).trim();
            if (!url.isEmpty() && OriginPolicy.originOf(url) == null) {
                throw new IllegalArgumentException("'url' must be an http or https URL");
            }
            if (body.has("gravity") && !body.isNull("gravity")) {
                Object g = body.opt("gravity");
                if (!"top".equals(g) && !"bottom".equals(g)) throw new IllegalArgumentException("'gravity' must be \"top\" or \"bottom\"");
                gravity = (String) g;
            }
        }
        return new OverlayRequest(hasText, text, hasUrl, url, gravity);
    }

    /**
     * {ok, shown, kind, text:{shown}, web:{shown,url}}. kind is "web" whenever the web
     * overlay shows, else "text", else "none". error is set when a layer that was asked
     * for is not showing.
     */
    static JSONObject answer(boolean textShown, boolean webShown, boolean textOverOtherApps,
                             boolean webOverOtherApps, String webUrl, String error) {
        try {
            JSONObject o = new JSONObject().put("ok", error == null);
            if (error != null) o.put("error", error);
            return o.put("shown", textShown || webShown)
                    .put("kind", webShown ? "web" : textShown ? "text" : "none")
                    .put("text", new JSONObject().put("shown", textShown).put("overOtherApps", textShown && textOverOtherApps))
                    .put("web", new JSONObject().put("shown", webShown)
                            .put("url", webShown && webUrl != null && !webUrl.isEmpty() ? webUrl : JSONObject.NULL)
                            .put("overOtherApps", webShown && webOverOtherApps));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
}
