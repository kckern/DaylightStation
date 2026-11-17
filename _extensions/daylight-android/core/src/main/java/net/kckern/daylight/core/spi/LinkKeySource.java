package net.kckern.daylight.core.spi;

/**
 * Provided by `notifications`: this install's link key. A daylight:// link that changes
 * something (an action, a memo) is honoured only when it carries the key, so the app's
 * own surfaces (shortcuts, tiles, the widget) ask for it here when they build a link.
 * It is never sent to a page, written to a log or returned by a route.
 */
public interface LinkKeySource {
    /** 32 or more characters. */
    String installKey();
}
