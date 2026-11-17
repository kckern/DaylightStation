package net.kckern.daylight.api;

/**
 * Which controller the kiosk Activity is attached to. Pure Java, so the rule that
 * matters is tested without an Activity: a controller may take itself out of the slot,
 * and may never take out the controller that replaced it.
 *
 * Why: a payload swap stops the old payload and starts the next one. The old payload's
 * stop() can land late (it is given up on after a missed deadline and stopped from
 * another thread), after the next payload's controller has attached. A detach that
 * cleared the slot whatever it held then left the new payload with no window.
 *
 * Not thread-safe: the Activity uses it on the main thread only.
 */
public final class KioskSlot {
    private KioskController current;

    public KioskController current() { return current; }

    /**
     * Put {@code next} in the slot. Returns the controller that was there and must now
     * be told it is detached, or null when there was none or it is {@code next} itself
     * (attaching the attached controller again changes nothing).
     */
    public KioskController replace(KioskController next) {
        KioskController old = current;
        if (old == next) return null;
        current = next;
        return old;
    }

    /** True when {@code next} is already the attached controller. */
    public boolean holds(KioskController next) { return next != null && current == next; }

    /**
     * Empty the slot only if it still holds {@code expected}. True when it did, and the
     * caller must then tell that controller it is detached. A null {@code expected}
     * never matches.
     */
    public boolean releaseIf(KioskController expected) {
        if (expected == null || current != expected) return false;
        current = null;
        return true;
    }

    /** Empty the slot whatever it holds (the Activity is being destroyed). Returns what it held. */
    public KioskController clear() {
        KioskController old = current;
        current = null;
        return old;
    }
}
