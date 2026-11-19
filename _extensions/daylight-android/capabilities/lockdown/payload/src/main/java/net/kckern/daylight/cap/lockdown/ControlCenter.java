package net.kckern.daylight.cap.lockdown;

import java.util.List;

/**
 * When to push the Portal's swipe-up Control Center back down. Pure Java; from
 * portal-keys' PortalKeysService ("Control Center suppression" in its README).
 *
 * The panel cannot be kept from opening, and accessibility reports its windows with no
 * title and no package, so it is recognized by shape: closed, it parks a thin gesture
 * strip on the bottom edge; open, it is a system window covering most of the display.
 * The threshold is loose (80% of each axis) so a resolution or rotation change does
 * not stop it matching.
 *
 * Measured on the Portal (2026-07-21): a dismissal sent the moment the panel is seen
 * does nothing, because the panel is still animating open and no further window event
 * follows. So: wait out the animation, check, swipe, check again, a bounded number of
 * times. The BACK global action does not close it (the panel is not focusable); a
 * downward swipe, the panel's own gesture, does.
 */
final class ControlCenter {
    static final long DEBOUNCE_MS = 800L;
    /** Lets the open animation finish before each check. */
    static final long SETTLE_MS = 400L;
    static final int MAX_ATTEMPTS = 6;
    static final double COVER = 0.8;

    /** One window as the accessibility service reports it: type and size on screen. */
    static final class Window {
        final int type, width, height;
        Window(int type, int width, int height) { this.type = type; this.width = width; this.height = height; }
    }

    private long lastActedAtMs = Long.MIN_VALUE / 2;

    /** True when a system window covers most of the display. An unknown size or list is not the panel. */
    static boolean isOpen(List<Window> windows, int displayWidth, int displayHeight) {
        if (windows == null || displayWidth <= 0 || displayHeight <= 0) return false;
        for (Window w : windows) {
            if (w == null || w.type != ForegroundTrail.TYPE_SYSTEM) continue;
            if (w.width >= displayWidth * COVER && w.height >= displayHeight * COVER) return true;
        }
        return false;
    }

    /** A window event showed the panel open. True when a dismissal should start; false inside the debounce. */
    synchronized boolean shouldStart(long nowMs) {
        if (nowMs - lastActedAtMs < DEBOUNCE_MS) return false;
        lastActedAtMs = nowMs;
        return true;
    }

    /** A swipe was sent: the events it causes must not start a second dismissal. */
    synchronized void swiped(long nowMs) { lastActedAtMs = nowMs; }

    /** Attempts are bounded so a panel that will not close cannot become an endless stream of swipes. */
    static boolean mayAttempt(int attempt) { return attempt <= MAX_ATTEMPTS; }
}
