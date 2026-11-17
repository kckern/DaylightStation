package net.kckern.daylight.api;

/**
 * Where a device's control API and lifeline listen, from `control.bind` in its device
 * file. Shared by the shell (the lifeline) and the payload (the control server) so the
 * two cannot disagree.
 */
public final class ControlBind {
    public static final String LAN = "lan";
    public static final String LOOPBACK = "loopback";
    /** No control server and no lifeline at all. For a device nobody operates remotely (a personal phone). */
    public static final String NONE = "none";
    private static final String LOOPBACK_HOST = "127.0.0.1";

    private ControlBind() { }

    /**
     * Does this device listen at all? True for "lan" and "loopback" only. "none", and
     * any value this class does not know, listens nowhere: a typo or a value from a
     * newer build never opens a port.
     */
    public static boolean listens(String bind) {
        return LAN.equals(bind) || LOOPBACK.equals(bind);
    }

    /**
     * The host name to hand NanoHTTPD: null (every interface) for "lan" and the
     * loopback address otherwise. Ask {@link #listens} first; for a bind that does not
     * listen this still answers the loopback address, the narrowest there is.
     */
    public static String host(String bind) {
        return LAN.equals(bind) ? null : LOOPBACK_HOST;
    }
}
