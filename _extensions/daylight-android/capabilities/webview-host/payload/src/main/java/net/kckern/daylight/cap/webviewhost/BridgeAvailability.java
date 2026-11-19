package net.kckern.daylight.cap.webviewhost;

/**
 * Whether the page bridge is offered at all. Pure Java.
 *
 * The bridge is offered only when its shim can be injected at document start, into
 * frames of an allowed origin. Without that feature the only way to put the shim in a
 * page is to evaluate it when a load starts, which runs in the OUTGOING document: a
 * page of any origin that navigates toward the start URL would be handed the bridge's
 * secret and could then launch apps, switch the screen, restart the app or reboot.
 * So on such a WebView there is no bridge, and GET /kiosk/status says why.
 */
final class BridgeAvailability {
    static final String AVAILABLE = "available";
    static final String UNAVAILABLE = "unavailable";

    final boolean available;
    /** Why not, or null when it is. */
    final String reason;

    private BridgeAvailability(boolean available, String reason) {
        this.available = available;
        this.reason = reason;
    }

    String state() { return available ? AVAILABLE : UNAVAILABLE; }

    /**
     * @param hasOrigins            at least one origin gets the bridge (a start URL or webview.bridgeOrigins)
     * @param documentStartSupported the WebView reports WebViewFeature.DOCUMENT_START_SCRIPT
     * @param injectionError        what adding the document-start script threw, or null
     */
    static BridgeAvailability decide(boolean hasOrigins, boolean documentStartSupported, String injectionError) {
        if (!hasOrigins) return new BridgeAvailability(false, "no origin is configured for the bridge (webview.startUrl is empty)");
        if (!documentStartSupported) {
            return new BridgeAvailability(false, "this device's WebView cannot inject a script at document start; "
                    + "update Android System WebView. The bridge is not offered without it");
        }
        if (injectionError != null) return new BridgeAvailability(false, "the document-start script was refused: " + injectionError);
        return new BridgeAvailability(true, null);
    }
}
