package net.kckern.daylight.api;

import java.util.concurrent.atomic.AtomicReference;

/**
 * Holds the one payload delegate of a shell component. A payload detaches with
 * clear(itself): if another payload has attached in the meantime, nothing changes.
 * During a swap the old payload can stop after the new one has started, and an
 * unconditional "set to null" from the old one would detach the new one.
 */
public final class DelegateSlot<T> {
    private final AtomicReference<T> current = new AtomicReference<>();

    public void set(T delegate) { current.set(delegate); }

    public T get() { return current.get(); }

    /** Empties the slot only if `expected` is what it holds. True when it did. */
    public boolean clear(T expected) { return current.compareAndSet(expected, null); }
}
