package net.kckern.daylight.cap.micbridge;

/**
 * What the last attempt to capture came to. Owned by the capability and handed to
 * each stream server, so it survives POST /mic/restart: a restart rebuilds the
 * socket and the overlay, and cannot by itself show that capture works again. The
 * record is cleared only when a capture really starts.
 */
final class CaptureState {
    /** The permission is granted and capture would still not start. */
    static final String CAPTURE_DENIED = "capture_denied";
    /** RECORD_AUDIO is not granted. */
    static final String PERMISSION_MISSING = "permission_missing";

    private volatile String code;
    private volatile String detail;

    void failed(String code, String detail) { this.detail = detail; this.code = code; }
    void recording() { code = null; detail = null; }

    String code() { return code; }
    String detail() { return detail; }
    boolean denied() { return CAPTURE_DENIED.equals(code); }
}
