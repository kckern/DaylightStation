package net.kckern.daylight.core;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.Map;
import java.util.Timer;
import java.util.TimerTask;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The one WebSocket channel of a device, on the control port. JSON text frames
 * keyed by "type". Transport-agnostic so it runs in JVM tests; ControlServer
 * adapts NanoWSD sockets to Client.
 */
public final class SocketHub {
    public interface Client {
        void send(String text) throws IOException;
        void ping() throws IOException;
        void close();
        /**
         * Cut the connection without writing to it. Called for a client that is not
         * reading, where close() (which sends a close frame) would block like any other
         * write. A transport that can close its socket outright overrides this.
         */
        default void abort() { close(); }
    }

    public interface Reply {
        void send(JSONObject message);
        /** Sends {"type":"error","code":code,"msg":message}, the shape the piano page expects. */
        void error(String code, String message);
    }

    public interface Handler { void handle(JSONObject message, Reply reply) throws Exception; }

    /**
     * Frames one client may have waiting. A client that reads keeps its queue near
     * empty; one that has stopped reading reaches this within minutes on status frames
     * alone, and is then closed.
     */
    static final int MAX_QUEUED = 512;

    private static final Object PING = new Object();

    private final String deviceId;
    private final StatusBoard status;
    private final Map<String, Handler> handlers = new ConcurrentHashMap<>();
    /** Every client with its own queue and its own sending thread. */
    private final Map<Client, Outbox> clients = new ConcurrentHashMap<>();
    private Timer timer;
    private int ticks;

    public SocketHub(String deviceId, StatusBoard status) {
        this.deviceId = deviceId;
        this.status = status;
    }

    /**
     * One client's outgoing frames. A socket write blocks for as long as the peer does
     * not read, and a write cannot be given a timeout, so no caller of broadcast (the
     * MIDI thread, the one-second tick) ever writes to a socket itself: it appends
     * here and returns. The client's own thread sends in the order frames were
     * appended, one at a time and at once, so a note waits only for the thread hand-off.
     */
    private final class Outbox implements Runnable {
        final Client client;
        private final java.util.ArrayDeque<Object> queue = new java.util.ArrayDeque<>();
        private boolean sending, closed;

        Outbox(Client client) { this.client = client; }

        /** False when the queue is full: the caller closes the client. */
        synchronized boolean offer(Object frame) {
            if (closed) return true;
            if (queue.size() >= MAX_QUEUED) return false;
            queue.add(frame);
            notifyAll();
            return true;
        }

        synchronized void close() {
            closed = true;
            queue.clear();
            notifyAll();
        }

        /** True while a frame is waiting or being written. */
        synchronized boolean backlogged() { return sending || !queue.isEmpty(); }

        synchronized boolean awaitIdle(long deadlineMs) throws InterruptedException {
            while (!closed && (sending || !queue.isEmpty())) {
                long left = deadlineMs - System.currentTimeMillis();
                if (left <= 0) return false;
                wait(left);
            }
            return true;
        }

        @Override public void run() {
            while (true) {
                Object frame;
                synchronized (this) {
                    sending = false;
                    notifyAll();
                    while (queue.isEmpty() && !closed) {
                        try { wait(); } catch (InterruptedException e) { return; }
                    }
                    if (closed) return;
                    frame = queue.poll();
                    sending = true;
                }
                try {
                    if (frame == PING) client.ping(); else client.send((String) frame);
                } catch (Throwable failed) {
                    // IOException from a dead socket; anything else from a broken transport.
                    drop(client, false);
                    return;
                }
            }
        }
    }

    /** One capability per message type. */
    public void on(String type, Handler handler) {
        if (handlers.putIfAbsent(type, handler) != null) {
            throw new IllegalStateException("socket message type registered twice: " + type);
        }
    }

    /** The message types a client may send, sorted. Everything else is answered unknown_type. */
    public java.util.Set<String> types() { return new java.util.TreeSet<>(handlers.keySet()); }

    public int clients() { return clients.size(); }

    /**
     * Queues the frame for every client and returns; it never writes to a socket.
     * Each client receives its frames in the order they were broadcast. A client whose
     * queue is full has stopped reading and is closed.
     */
    public void broadcast(String text) {
        if (text == null) return;
        for (Outbox o : clients.values()) enqueue(o, text);
    }

    /** The same as broadcast, which no longer does socket I/O on the caller's thread. */
    public void broadcastAsync(final String text) { broadcast(text); }

    private void enqueue(Outbox o, Object frame) {
        if (!o.offer(frame)) drop(o.client, true);
    }

    /**
     * Forget a client. `stuck` is a client that is not reading: a polite close would
     * queue behind the write that is already blocked, so its connection is cut.
     */
    private void drop(Client c, boolean stuck) {
        Outbox o = clients.remove(c);
        if (o == null) return;
        o.close();
        if (stuck) {
            try { c.abort(); } catch (Throwable ignored) { }
        }
    }

    /** Waits until every queued frame has been written. For tests, which read what a client received. */
    public boolean awaitDelivered(long timeoutMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        for (Outbox o : clients.values()) {
            if (!o.awaitIdle(deadline)) return false;
        }
        return true;
    }

    // --- called by the transport ---

    public void opened(Client c) {
        Outbox o = new Outbox(c);
        clients.put(c, o);
        Thread t = new Thread(o, "Daylight-ws-out");
        t.setDaemon(true);
        t.start();
        try {
            enqueue(o, new JSONObject().put("type", "ready").put("device", deviceId).toString());
        } catch (JSONException e) {
            drop(c, false);
        }
    }

    public void closed(Client c) { drop(c, false); }

    public void message(final Client c, String text) {
        final Reply reply = new Reply() {
            @Override public void send(JSONObject message) {
                // Through the client's queue, so an answer keeps its place among broadcasts.
                Outbox o = clients.get(c);
                if (o != null) enqueue(o, message.toString());
            }
            @Override public void error(String code, String message) {
                try {
                    send(new JSONObject().put("type", "error").put("code", code).put("msg", message == null ? "" : message));
                } catch (JSONException ignored) { }
            }
        };
        if ("ping".equals(text)) {
            try { reply.send(new JSONObject().put("type", "pong")); } catch (JSONException ignored) { }
            return;
        }
        JSONObject message;
        String type;
        try {
            message = new JSONObject(text);
            type = message.optString("type", "");
        } catch (Exception e) {
            reply.error("bad_json", "could not parse frame");
            return;
        }
        Handler handler = handlers.get(type);
        if (handler == null) {
            reply.error("unknown_type", "unhandled type: " + type);
            return;
        }
        try {
            handler.handle(message, reply);
        } catch (Throwable e) {
            // Throwable, as in Router.dispatch: a linkage Error must not end the socket's thread.
            reply.error("dispatch_failed", e.getMessage());
        }
    }

    // --- timer ---

    public synchronized void start() {
        if (timer != null) return;
        timer = new Timer("Daylight-ws-heartbeat", true);
        timer.scheduleAtFixedRate(new TimerTask() {
            @Override public void run() { try { tick(); } catch (Throwable ignored) { } }
        }, 1000L, 1000L);
    }

    /** One second of work: the status frame, and a keepalive ping every third call. */
    void tick() {
        if (!clients.isEmpty() && status.has(StatusBoard.Surface.FRAME)) {
            try {
                broadcast(status.collect(StatusBoard.Surface.FRAME, new JSONObject().put("type", "status")).toString());
            } catch (JSONException ignored) { }
        }
        if (++ticks % 3 == 0) {
            for (Outbox o : clients.values()) enqueue(o, PING);
        }
    }

    /** The listener cannot release the port while a socket is open. */
    public void closeClients() {
        for (Outbox o : new java.util.ArrayList<>(clients.values())) {
            clients.remove(o.client);
            boolean stuck = o.backlogged();
            o.close();
            try {
                if (stuck) o.client.abort(); else o.client.close();
            } catch (Throwable ignored) { }
        }
    }

    public synchronized void stop() {
        if (timer != null) { timer.cancel(); timer = null; }
        closeClients();
    }
}
