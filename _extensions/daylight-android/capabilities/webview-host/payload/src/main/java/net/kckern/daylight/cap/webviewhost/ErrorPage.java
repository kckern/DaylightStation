package net.kckern.daylight.cap.webviewhost;

/**
 * The pages the kiosk shows on its own: the app server cannot be reached, or no start
 * URL is configured. Built in Java because a payload is a dex jar and carries no assets.
 * Loaded with a null base URL, so their origin is about:blank and they never receive
 * the bridge.
 */
final class ErrorPage {
    private ErrorPage() { }

    static String html(String url, String error, long retryInMs) {
        String retry = retryInMs < 0 ? "No retry is scheduled."
                : "Trying again in " + Math.max(1, Math.round(retryInMs / 1000.0)) + " s.";
        return page("This screen cannot reach the house server",
                "<p>" + escape(retry) + "</p>"
                + "<p><code>" + escape(url) + "</code></p>"
                + "<p><code>" + escape(error) + "</code></p>");
    }

    /** No start URL: nothing was tried, so the page gives setup instructions. */
    static String notConfigured(String deviceId) {
        return page("This screen is not set up yet",
                "<p>No start page is configured for this device.</p>"
                + "<p><code>webview.startUrl</code> is empty on <code>" + escape(deviceId) + "</code></p>");
    }

    private static String page(String heading, String body) {
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>html,body{height:100%;margin:0;background:#111;color:#bbb;font-family:sans-serif}"
                + "main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 8%}"
                + "h1{color:#eee;font-weight:500;font-size:28px;margin:0 0 16px}p{margin:6px 0;font-size:16px;word-break:break-all}"
                + "code{color:#888}</style></head><body><main>"
                + "<h1>" + escape(heading) + "</h1>" + body
                + "</main></body></html>";
    }

    static String escape(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&': out.append("&amp;"); break;
                case '<': out.append("&lt;"); break;
                case '>': out.append("&gt;"); break;
                case '"': out.append("&quot;"); break;
                case '\'': out.append("&#39;"); break;
                default: out.append(c);
            }
        }
        return out.toString();
    }
}
