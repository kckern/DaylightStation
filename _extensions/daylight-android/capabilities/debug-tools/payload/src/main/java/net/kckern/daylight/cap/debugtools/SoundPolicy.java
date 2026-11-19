package net.kckern.daylight.cap.debugtools;

import net.kckern.daylight.core.kiosk.Origins;

import java.util.Set;

/**
 * Which URLs POST /sound may fetch. Pure Java.
 *
 * The device fetches the URL itself, so a route that took any URL would let a caller
 * make the kiosk read a local file or call any host it can reach. Only http and https
 * are ever played, and only from an origin the kiosk already trusts: the start URL's
 * origin, webview.bridgeOrigins, and whatever debug.soundOrigins adds ("*" there means
 * any http or https origin).
 */
final class SoundPolicy {
    private SoundPolicy() { }

    /** Null when the URL may be played, otherwise the reason it is refused. */
    static String refusal(String url, String startUrl, String bridgeOrigins, String soundOrigins) {
        String origin = Origins.of(url);
        if (origin == null) return "body needs an http or https 'url', or 'stop': true";
        if (soundOrigins != null) {
            for (String part : soundOrigins.split(",")) if (part.trim().equals("*")) return null;
        }
        Set<String> trusted = Origins.list(bridgeOrigins);
        String start = Origins.of(startUrl);
        if (start != null) trusted.add(start);
        trusted.addAll(Origins.list(soundOrigins));
        if (trusted.contains(origin)) return null;
        return "the url's origin is not one this kiosk trusts (the start URL's origin, webview.bridgeOrigins); "
                + "add it to debug.soundOrigins to allow it. Only http and https are ever played";
    }
}
