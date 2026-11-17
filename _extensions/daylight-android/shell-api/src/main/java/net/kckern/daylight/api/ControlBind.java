package net.kckern.daylight.api;

/**
 * Where a device's control API and lifeline listen, from `control.bind` in its device
 * file. Shared by the shell (the lifeline) and the payload (the control server) so the
 * two cannot disagree.
 */
public final class ControlBind {
    public static final String LAN = "lan";
    public static final String LOOPBACK = "loopback";
    private static final String LOOPBACK_HOST = "127.0.0.1";

    private ControlBind() { }

    /**
     * The host name to hand NanoHTTPD: null (every interface) for "lan" and the
     * loopback address for everything else. The build accepts only the two names; a
     * value this class does not know is treated as loopback, the narrower of the two.
     */
    public static String host(String bind) {
        return LAN.equals(bind) ? null : LOOPBACK_HOST;
    }
}
