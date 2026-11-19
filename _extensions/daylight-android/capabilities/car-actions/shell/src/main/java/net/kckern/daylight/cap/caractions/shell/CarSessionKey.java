package net.kckern.daylight.cap.caractions.shell;

/**
 * A car session, as the bind intent names it. Pure.
 *
 * The Car App Library's SessionInfoIntentEncoder writes a SessionInfo twice: as
 * "<display type>/<session id>" (SessionInfo.toString) into the intent's identifier
 * (Android 10 and later) or its data path, which Intent.filterEquals compares, and as
 * an extras bundle, which it does not and from which onBind decodes it. The gate reads
 * the first, which is the same for every client of one binding, and rebuilds the
 * second itself; a client's extras are never passed on.
 */
final class CarSessionKey {
    private static final int MAX_ID = 128;

    final int displayType;
    final String sessionId;

    private CarSessionKey(int displayType, String sessionId) {
        this.displayType = displayType;
        this.sessionId = sessionId;
    }

    /** Null for anything that is not such a key; the library's default session then applies. */
    static CarSessionKey parse(String key) {
        if (key == null) return null;
        String k = key.startsWith("/") ? key.substring(1) : key;
        int slash = k.indexOf('/');
        if (slash != 1) return null;
        char type = k.charAt(0);
        // SessionInfo.DISPLAY_TYPE_MAIN (0) and DISPLAY_TYPE_CLUSTER (1).
        if (type != '0' && type != '1') return null;
        String id = k.substring(2);
        if (id.isEmpty() || id.length() > MAX_ID) return null;
        for (int i = 0; i < id.length(); i++) if (id.charAt(i) < 0x20 || id.charAt(i) == 0x7f) return null;
        return new CarSessionKey(type - '0', id);
    }
}
