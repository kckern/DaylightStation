package net.kckern.daylight.cap.debugtools;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Follows a sound URL's redirects by hand, so that every hop is held to the same
 * origin rule as the URL that was asked for.
 *
 * The media player follows redirects by itself. A trusted origin that redirected
 * (an open redirect is enough) could then make the kiosk fetch from any host it can
 * reach. Here nothing is followed automatically: each answer is looked at, each
 * Location is resolved and checked, and at most MAX_HOPS redirects are taken. What
 * comes back is the address that answered without redirecting; that is what is played.
 */
final class SoundRedirects {
    static final int MAX_HOPS = 3;

    /** Asks one URL where it redirects to. */
    interface Probe {
        /** The absolute URL the answer redirects to, or null when the answer is not a redirect. */
        String next(String url) throws Exception;
    }

    /** The origin rule: null when the URL may be fetched, otherwise why not. */
    interface Check { String refusal(String url); }

    /** A hop that the origin rule refuses, or too many hops. The message says which. */
    static final class Refused extends IllegalArgumentException {
        Refused(String why) { super(why); }
    }

    private SoundRedirects() { }

    /**
     * @return the URL to hand to the player
     * @throws Refused when a hop leaves the trusted origins, or there are more than MAX_HOPS redirects
     */
    static String resolve(String url, Probe probe, Check check) throws Exception {
        String current = url;
        for (int hop = 0; ; hop++) {
            String refusal = check.refusal(current);
            if (refusal != null) {
                throw new Refused(hop == 0 ? refusal : "redirect " + hop + " leaves the origins this kiosk trusts: " + refusal);
            }
            String next = probe.next(current);
            if (next == null) return current;
            if (hop >= MAX_HOPS) throw new Refused("more than " + MAX_HOPS + " redirects");
            current = next;
        }
    }

    /** The real probe: one request that follows nothing. The body is not read. */
    static String httpNext(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(5000);
        c.setReadTimeout(5000);
        // One byte is enough to learn whether this answers or redirects.
        c.setRequestProperty("Range", "bytes=0-0");
        try {
            int code = c.getResponseCode();
            if (code != 301 && code != 302 && code != 303 && code != 307 && code != 308) return null;
            String location = c.getHeaderField("Location");
            if (location == null || location.trim().isEmpty()) return null;
            return new URL(new URL(url), location.trim()).toString();
        } finally {
            c.disconnect();
        }
    }
}
