package net.kckern.daylight.cap.micbridge;

import java.net.URI;
import java.util.Locale;

/**
 * Who may open the microphone stream. The socket is on loopback and has no token,
 * so any app or page on the device can reach it; a browser tells the server which
 * page is asking in the Origin header of the WebSocket handshake. Pure.
 */
final class MicOriginRule {
    private MicOriginRule() { }

    /**
     * @param origin        the handshake's Origin header, or null when it sent none
     * @param startUrl      the device's webview.startUrl; null or empty when the device has none
     * @param peerLoopback  the connection comes from this device
     * @param allowNoOrigin the mic.allowNoOrigin setting
     */
    static boolean admits(String origin, String startUrl, boolean peerLoopback, boolean allowNoOrigin) {
        if (origin == null || origin.trim().isEmpty()) {
            // A client that is not a web page (or a host app that strips the header).
            return peerLoopback && allowNoOrigin;
        }
        String want = originOf(startUrl);
        String got = originOf(origin);
        return want != null && want.equals(got);
    }

    /** scheme://host:port with the scheme's default port filled in, or null when the text is not such a URL. */
    static String originOf(String url) {
        if (url == null || url.trim().isEmpty()) return null;
        try {
            URI u = new URI(url.trim());
            String scheme = u.getScheme(), host = u.getHost();
            if (scheme == null || host == null) return null;
            scheme = scheme.toLowerCase(Locale.ROOT);
            int port = u.getPort();
            if (port < 0) port = "https".equals(scheme) || "wss".equals(scheme) ? 443 : "http".equals(scheme) || "ws".equals(scheme) ? 80 : -1;
            if (port < 0) return null;
            return scheme + "://" + host.toLowerCase(Locale.ROOT) + ":" + port;
        } catch (Exception notAUrl) {
            return null;
        }
    }
}
