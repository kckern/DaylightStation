package net.kckern.daylight.core;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.Timer;
import java.util.TimerTask;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

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
    }

    public interface Reply {
        void send(JSONObject message);
        /** Sends {"type":"error","code":code,"msg":message}, the shape the piano page expects. */
        void error(String code, String message);
    }

    public interface Handler { void handle(JSONObject message, Reply reply) throws Exception; }

    private final String deviceId;
    private final StatusBoard status;
    private final Map<String, Handler> handlers = new ConcurrentHashMap<>();
    private final Set<Client> clients = ConcurrentHashMap.newKeySet();
    private final ExecutorService sender = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-ws-send");
        t.setDaemon(true);
        return t;
    });
    private Timer timer;
    private int ticks;

    public SocketHub(String deviceId, StatusBoard status) {
        this.deviceId = deviceId;
        this.status = status;
    }

    /** One capability per message type. */
    public void on(String type, Handler handler) {
        if (handlers.putIfAbsent(type, handler) != null) {
            throw new IllegalStateException("socket message type registered twice: " + type);
        }
    }

    public int clients() { return clients.size(); }

    /** Sends on the caller's thread. Use for live notes, where a thread hop is latency. */
    public void broadcast(String text) {
        if (text == null) return;
        for (Client c : clients) {
            try { c.send(text); } catch (IOException e) { clients.remove(c); }
        }
    }

    /** Sends from the hub's own thread. Use from the main thread, where socket I/O is fatal. */
    public void broadcastAsync(final String text) {
        try { sender.execute(() -> broadcast(text)); } catch (RejectedExecutionException stopped) { }
    }

    // --- called by the transport ---

    public void opened(Client c) {
        clients.add(c);
        try {
            c.send(new JSONObject().put("type", "ready").put("device", deviceId).toString());
        } catch (IOException | JSONException e) {
            clients.remove(c);
        }
    }

    public void closed(Client c) { clients.remove(c); }

    public void message(final Client c, String text) {
        final Reply reply = new Reply() {
            @Override public void send(JSONObject message) {
                try { c.send(message.toString()); } catch (IOException e) { clients.remove(c); }
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
        } catch (Exception e) {
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
            for (Client c : clients) {
                try { c.ping(); } catch (IOException e) { clients.remove(c); }
            }
        }
    }

    /** The listener cannot release the port while a socket is open. */
    public void closeClients() {
        for (Client c : clients) {
            try { c.close(); } catch (Throwable ignored) { }
        }
        clients.clear();
    }

    public synchronized void stop() {
        if (timer != null) { timer.cancel(); timer = null; }
        closeClients();
        sender.shutdownNow();
    }
}
