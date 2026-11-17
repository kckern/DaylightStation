package net.kckern.daylight.cap.webviewhost;

import net.kckern.daylight.core.kiosk.Origins;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Where the kiosk's main frame may go. Pure Java.
 *
 * Only the start URL's origin and the origins a device adds. Without this any link to
 * another site turned the kiosk into a browser with no address bar and no way back
 * but the Back key.
 *
 * It is about the main frame alone. Sub-resources and iframes are not restricted here:
 * the household page embeds media and frames from other origins.
 */
final class NavigationPolicy {
    private final Set<String> origins;

    private NavigationPolicy(Set<String> origins) { this.origins = origins; }

    /**
     * @param startUrl the start page; its origin is always allowed
     * @param lists    comma-separated origins or URLs (webview.allowedOrigins, and the
     *                 phone's links.origins); null and empty entries add nothing
     */
    static NavigationPolicy of(String startUrl, String... lists) {
        Set<String> out = new LinkedHashSet<>();
        String start = Origins.of(startUrl);
        if (start != null) out.add(start);
        if (lists != null) for (String list : lists) out.addAll(Origins.list(list));
        return new NavigationPolicy(Collections.unmodifiableSet(out));
    }

    /** May the main frame load this URL? Anything with no http or https origin may not. */
    boolean allows(String url) {
        String o = Origins.of(url);
        return o != null && origins.contains(o);
    }

    /** The origin of a URL for a log line, never the URL itself (a path can carry a token). */
    static String originForLog(String url) {
        String o = Origins.of(url);
        return o == null ? "(no http origin)" : o;
    }

    Set<String> origins() { return origins; }

    /**
     * Counts main-frame loads that were stopped for leaving the allowed origins. The
     * kiosk answers such a load by loading its start page. If the start page itself
     * leads away (a redirect to a sign-in host that is not on the list), that answer
     * would repeat at the speed of the network, for ever. After MAX stops inside the
     * window the load is settled as failed: the local error page shows, and the start
     * page is tried again only on the usual retry delay, which doubles.
     */
    static final class BounceGuard {
        static final int MAX = 3;
        static final long WINDOW_MS = 60_000L;

        private int stops;
        private long lastAtMs;

        /** A load was stopped. True when the kiosk should stop reloading its start page at once. */
        synchronized boolean stoppedAndGiveUp(long nowMs) {
            if (nowMs - lastAtMs > WINDOW_MS) stops = 0;
            stops++;
            lastAtMs = nowMs;
            return stops > MAX;
        }

        /** A page on an allowed origin finished loading: the run is over. */
        synchronized void settled() { stops = 0; }
    }
}
