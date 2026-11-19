package net.kckern.daylight.shell;

import net.kckern.daylight.api.ControlBind;

import java.security.SecureRandom;

/**
 * The token this process hands the payload.
 *
 * A device that listens (control.bind lan or loopback) uses the token compiled into
 * its APK: that is the secret its operator presents. A device that listens nowhere
 * (control.bind none) has no token compiled in at all, because an APK is readable by
 * every app on the phone. The payload's router still wants a token to compare against,
 * so it is given one made up for this process: random, never stored, never shown, and
 * so never presentable by anybody.
 */
final class ControlToken {
    private ControlToken() { }

    static String forBind(String bind, String compiled, SecureRandom random) {
        if (ControlBind.listens(bind)) return compiled;
        byte[] b = new byte[32];
        random.nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }
}
