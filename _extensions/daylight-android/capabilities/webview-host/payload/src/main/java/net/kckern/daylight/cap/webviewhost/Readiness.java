package net.kckern.daylight.cap.webviewhost;

/** Why GET /kiosk/status says ready:false. Pure Java. */
final class Readiness {
    private Readiness() { }

    /** Null when the kiosk is ready: an Activity is showing a page that loaded. */
    static String notReadyReason(String startUrl, boolean attached, LoadTracker.State state,
                                 boolean errorPage, String lastError) {
        if (startUrl == null || startUrl.trim().isEmpty()) return "webview.startUrl is not set";
        if (!attached) return "no kiosk activity";
        switch (state) {
            case LOADING: return "loading";
            case FAILED: return lastError == null ? "load failed" : "load failed: " + lastError;
            case IDLE: return "no page loaded";
            default: return errorPage ? "showing the error page" : null;
        }
    }
}
