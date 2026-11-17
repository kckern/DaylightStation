package net.kckern.daylight.core.spi;

/**
 * Provided by `notifications`: this install's link key. A daylight:// link that changes
 * something (an action, a memo) is honoured only when it carries the key, so the app's
 * own surfaces (shortcuts, tiles, the widget) ask for it here when they build a link.
 * It is never sent to a page, written to a log or returned by a route.
 *
 * The key is replaced at every payload start. A capability that builds links starts
 * after `notifications` and builds them again at each start; a link built in an
 * earlier run stops working a minute after the next one begins.
 */
public interface LinkKeySource {
    /** 32 or more characters. */
    String installKey();

    /**
     * The link with the key where a key travels: in the fragment, which Android leaves
     * out of the line it writes to the system log when it starts a link.
     */
    default String keyed(String link) {
        String key = installKey();
        if (key == null || key.isEmpty()) return link;
        int hash = link.indexOf('#');
        return (hash < 0 ? link : link.substring(0, hash)) + "#k=" + key;
    }
}
