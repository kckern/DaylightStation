package net.kckern.daylight.cap.mediaservice.shell;

import java.util.concurrent.atomic.AtomicBoolean;

/** Coalesces a burst of refresh asks into one run: the first arms, the rest ride on it until it fires. */
final class RefreshGate {
    private final AtomicBoolean armed = new AtomicBoolean();

    /** True when the caller should schedule the refresh; false when one is already scheduled. */
    boolean arm() { return armed.compareAndSet(false, true); }

    /** The scheduled refresh is starting: the next ask schedules another. */
    void fired() { armed.set(false); }
}
