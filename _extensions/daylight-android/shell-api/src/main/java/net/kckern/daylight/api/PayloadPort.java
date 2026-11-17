package net.kckern.daylight.api;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * How an installed component that Android creates by class name (a link activity, a
 * tile, a widget) asks the payload to do something. ShellComponents carries objects
 * from the shell to the payload; this is the other direction.
 *
 * A port has a name both sides know. The payload attaches a handler to it when it
 * starts and detaches that handler when it stops. The installed component calls it.
 * Requests and answers are JSON text, so the two sides share no types and a payload
 * swap cannot break an installed component.
 *
 * Cold start: the component may run in a process whose payload is not loaded yet. It
 * starts the shell service and calls with a wait; the call returns as soon as a
 * handler attaches, and throws NotReadyException when none does in time. The caller
 * then does its stated fallback. Nothing here crosses a process or a socket, so no
 * other app can reach a port.
 */
public final class PayloadPort {
    /** The port the link activity hands links to. Request {"uri": "..."}; answer: a link effect. */
    public static final String LINKS = "links";

    public interface Handler {
        /** Runs on the caller's thread, which is never the main thread. */
        String handle(String request) throws Exception;
    }

    /** No payload attached a handler within the wait. Nothing was delivered. */
    public static final class NotReadyException extends Exception {
        public NotReadyException(String port) { super("no payload is serving '" + port + "'"); }
    }

    private static final Map<String, PayloadPort> PORTS = new ConcurrentHashMap<>();

    private final String name;
    private final Object lock = new Object();
    private Handler handler;

    private PayloadPort(String name) { this.name = name; }

    public static PayloadPort named(String name) {
        return PORTS.computeIfAbsent(name, PayloadPort::new);
    }

    /** Called by a payload when it starts. Replaces the handler of a payload that is being swapped out. */
    public void attach(Handler h) {
        synchronized (lock) {
            handler = h;
            lock.notifyAll();
        }
    }

    /**
     * Called by a payload when it stops, with the handler it attached. During a swap the
     * old payload can stop after the new one has started; it then removes nothing.
     */
    public boolean detach(Handler h) {
        synchronized (lock) {
            if (handler != h) return false;
            handler = null;
            return true;
        }
    }

    public boolean ready() {
        synchronized (lock) { return handler != null; }
    }

    /**
     * Hand one request to the payload. The request is delivered at most once: when the
     * handler throws, its exception comes back and nothing is tried again, so an action
     * that failed halfway is never run twice.
     *
     * @param waitMs how long to wait for a payload to attach; 0 for not at all
     */
    public String call(String request, long waitMs) throws Exception {
        Handler h = await(waitMs);
        if (h == null) throw new NotReadyException(name);
        return h.handle(request);
    }

    private Handler await(long waitMs) {
        long deadline = System.currentTimeMillis() + Math.max(0, waitMs);
        synchronized (lock) {
            while (handler == null) {
                long left = deadline - System.currentTimeMillis();
                if (left <= 0) return null;
                try {
                    lock.wait(left);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return null;
                }
            }
            return handler;
        }
    }
}
