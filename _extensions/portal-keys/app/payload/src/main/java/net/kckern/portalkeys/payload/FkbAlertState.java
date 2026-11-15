package net.kckern.portalkeys.payload;

import java.util.ArrayDeque;

/** Retains observed Fully transitions until the private outbox accepts them. */
final class FkbAlertState {
    interface Writer { void write(String event) throws Exception; }
    private final ArrayDeque<String> pending = new ArrayDeque<>();
    private boolean lastObserved;
    private String error;

    FkbAlertState(boolean initialSecure) { lastObserved = initialSecure; }
    synchronized void observe(boolean secure) {
        if (secure != lastObserved) {
            pending.addLast(secure ? "fkb-restored" : "fkb-lost");
            lastObserved = secure;
        }
    }
    synchronized void deliver(Writer writer) {
        try {
            while (!pending.isEmpty()) {
                writer.write(pending.getFirst());
                pending.removeFirst();
            }
            error = null;
        } catch (Exception e) { error = e.getClass().getSimpleName(); }
    }
    synchronized boolean ready() { return pending.isEmpty() && error == null; }
    synchronized String error() { return error; }
}
