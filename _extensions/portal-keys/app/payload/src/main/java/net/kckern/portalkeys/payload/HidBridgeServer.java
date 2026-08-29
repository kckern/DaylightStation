package net.kckern.portalkeys.payload;

import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoWSD;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

/** Loopback-only keyboard event socket consumed by Fully's local WebView. */
final class HidBridgeServer extends NanoWSD {
    static final int PORT = 8774;
    private final CopyOnWriteArrayList<HidSocket> sockets = new CopyOnWriteArrayList<>();
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService repeats = Executors.newSingleThreadScheduledExecutor();
    private final Map<Integer, ScheduledFuture<?>> repeatTasks = new ConcurrentHashMap<>();
    private final AtomicLong events = new AtomicLong();
    private volatile UsbHidController controller;

    HidBridgeServer() { super("127.0.0.1", PORT); }

    void setController(UsbHidController controller) { this.controller = controller; }

    void publish(final HidKeyEvent event) {
        if ("down".equals(event.action) && !event.repeat && event.repeatable()) startRepeat(event);
        if ("up".equals(event.action)) stopRepeat(event.usage);
        send(event);
    }

    private void send(final HidKeyEvent event) {
        events.incrementAndGet();
        final String message = event.toJson();
        sender.execute(new Runnable() {
            @Override public void run() {
                for (HidSocket socket : sockets) {
                    try {
                        if (socket.isOpen()) socket.send(message);
                        else sockets.remove(socket);
                    } catch (IOException e) {
                        sockets.remove(socket);
                    }
                }
            }
        });
    }

    private void startRepeat(final HidKeyEvent event) {
        stopRepeat(event.usage);
        repeatTasks.put(event.usage, repeats.scheduleAtFixedRate(new Runnable() {
            @Override public void run() { send(event.asRepeat()); }
        }, 450, 50, TimeUnit.MILLISECONDS));
    }

    private void stopRepeat(int usage) {
        ScheduledFuture<?> task = repeatTasks.remove(usage);
        if (task != null) task.cancel(false);
    }

    @Override protected WebSocket openWebSocket(IHTTPSession handshake) {
        HidSocket socket = new HidSocket(handshake);
        sockets.add(socket);
        return socket;
    }

    @Override protected Response serveHttp(IHTTPSession session) {
        if (!"/".equals(session.getUri()) && !"/status".equals(session.getUri())) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found");
        }
        JSONObject out = Jsons.object("ok", true, "app", "portal-hid",
                "bind", "127.0.0.1", "port", PORT,
                "clients", sockets.size(), "events", events.get());
        UsbHidController c = controller;
        if (c != null) Jsons.put(out, "usb", c.status());
        return newFixedLengthResponse(Response.Status.OK, "application/json", out.toString());
    }

    @Override public void stop() {
        for (ScheduledFuture<?> task : repeatTasks.values()) task.cancel(false);
        repeatTasks.clear();
        repeats.shutdownNow();
        sender.shutdownNow();
        super.stop();
    }

    private final class HidSocket extends WebSocket {
        HidSocket(IHTTPSession handshake) { super(handshake); }
        @Override protected void onOpen() {
            try { send(Jsons.object("type", "ready", "port", PORT).toString()); }
            catch (IOException ignored) { }
        }
        @Override protected void onClose(WebSocketFrame.CloseCode code, String reason, boolean remote) {
            sockets.remove(this);
        }
        @Override protected void onMessage(WebSocketFrame message) {
            if ("ping".equals(message.getTextPayload())) {
                try { send("{\"type\":\"pong\"}"); } catch (IOException ignored) { }
            }
        }
        @Override protected void onPong(WebSocketFrame pong) { }
        @Override protected void onException(IOException exception) { sockets.remove(this); }
    }
}
