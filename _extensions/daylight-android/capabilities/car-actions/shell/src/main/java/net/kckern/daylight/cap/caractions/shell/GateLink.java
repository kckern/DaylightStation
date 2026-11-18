package net.kckern.daylight.cap.caractions.shell;

/**
 * The car gate's link to the library's binder in process. Pure: the binding is a seam.
 *
 * Android keeps a service's binder for an intent while the service lives, and can hand
 * the same gate binder back to a client after an unbind without asking again. So a
 * release is never final: it unbinds, wakes whoever waits, and the next transaction
 * that is let through binds again.
 */
final class GateLink<T> {
    interface Binding {
        /** Starts the bind; the connection arrives later through connected(). False when Android refused. */
        boolean bind();
        void unbind();
    }

    private final Binding binding;
    private final Object lock = new Object();
    private T real;
    private boolean bound;
    /** Moves on at every release, so a waiter of an earlier binding stops waiting. */
    private long generation;

    GateLink(Binding binding) { this.binding = binding; }

    /** The library's binder, binding first if need be; null when none arrives in time. */
    T await(long waitMs) {
        synchronized (lock) {
            if (real != null) return real;
            if (!bound) {
                if (!binding.bind()) return null;
                bound = true;
            }
            long mine = generation;
            long deadline = System.currentTimeMillis() + waitMs;
            while (real == null && generation == mine) {
                long left = deadline - System.currentTimeMillis();
                if (left <= 0) return null;
                try {
                    lock.wait(left);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return null;
                }
            }
            return generation == mine ? real : null;
        }
    }

    /** The binder as it is now, without binding. */
    T awaitNoBind() {
        synchronized (lock) { return real; }
    }

    boolean bound() {
        synchronized (lock) { return bound; }
    }

    void connected(T service) {
        synchronized (lock) {
            // A connection that arrives after its binding was released is not used.
            if (!bound) return;
            real = service;
            lock.notifyAll();
        }
    }

    /** The service went away; Android reconnects the same binding if it comes back. */
    void disconnected() {
        synchronized (lock) { real = null; }
    }

    /** Unbinds if bound and wakes waiters. The link stays usable. */
    void release() {
        boolean wasBound;
        synchronized (lock) {
            wasBound = bound;
            bound = false;
            real = null;
            generation++;
            lock.notifyAll();
        }
        if (wasBound) binding.unbind();
    }
}
