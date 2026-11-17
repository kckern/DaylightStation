package net.kckern.daylight.core;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import fi.iki.elonen.NanoWSD;

/** The NanoHTTPD/NanoWSD adapter. HTTP behavior lives in Router, socket behavior in SocketHub. */
public final class ControlServer extends NanoWSD {
    private final Router router;
    private final Auth auth;
    private final SocketHub hub;

    /** HTTP only. */
    public ControlServer(int port, Router router) { this(port, router, null, null); }

    public ControlServer(int port, Router router, Auth auth, SocketHub hub) {
        super(port);
        this.router = router;
        this.auth = auth;
        this.hub = hub;
    }

    /**
     * Start a server, retrying while the port is still held. On a payload hot swap the
     * previous payload's listener can still be closing. NanoHTTPD.start() does not throw
     * on a bind failure: the listener thread records it and dies, so the check is
     * wasStarted() and isAlive() a moment later. A failed NanoHTTPD cannot be restarted,
     * hence the factory. Returns null when every attempt failed.
     */
    public static ControlServer startWithRetry(Supplier<ControlServer> factory, int attempts) {
        for (int attempt = 1; attempt <= attempts; attempt++) {
            ControlServer server = factory.get();
            try {
                server.start(0, true);   // 0 = no socket read timeout; daemon thread
                Thread.sleep(150L);
                if (server.wasStarted() && server.isAlive()) return server;
            } catch (IOException e) {
                // fall through to the retry
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
            try { server.stop(); } catch (Throwable ignored) { }
            try { Thread.sleep(300L); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return null; }
        }
        return null;
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (isWebsocketRequested(session)) {
            if (hub == null || auth == null) {
                return respond(Router.Response.error(404, "unknown_route", "message", "no socket on this server"));
            }
            String token = session.getHeaders().get(Auth.HEADER);
            if (token == null) {
                List<String> q = session.getParameters().get("token");
                if (q != null && !q.isEmpty()) token = q.get(0);
            }
            if (!auth.accepts(token)) return respond(Router.Response.error(401, "unauthorized", "message", null));
        }
        return super.serve(session);
    }

    @Override
    protected WebSocket openWebSocket(IHTTPSession handshake) { return new HubSocket(handshake); }

    @Override
    protected Response serveHttp(IHTTPSession session) {
        String body = null;
        Method method = session.getMethod();
        if (method == Method.POST || method == Method.PUT) {
            Map<String, String> files = new HashMap<>();
            try {
                session.parseBody(files);
            } catch (Exception e) {
                return respond(Router.Response.error(400, "bad_request", "message", "unreadable body"));
            }
            body = files.get("postData");
        }
        Map<String, String> query = new HashMap<>();
        for (Map.Entry<String, List<String>> e : session.getParameters().entrySet()) {
            if (!e.getValue().isEmpty()) query.put(e.getKey(), e.getValue().get(0));
        }
        return respond(router.dispatch(method.name(), session.getUri(),
                session.getHeaders().get(Auth.HEADER), query, body, session.getRemoteIpAddress()));
    }

    @Override
    public void stop() {
        if (hub != null) hub.closeClients();
        super.stop();
        for (int i = 0; i < 20 && isAlive(); i++) {
            try { Thread.sleep(100L); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
        }
    }

    private static Response respond(Router.Response r) {
        Response.IStatus status = Response.Status.lookup(r.status);
        if (status == null) status = Response.Status.INTERNAL_ERROR;
        return newFixedLengthResponse(status, r.contentType, new ByteArrayInputStream(r.body), r.body.length);
    }

    private final class HubSocket extends WebSocket implements SocketHub.Client {
        HubSocket(IHTTPSession handshake) { super(handshake); }

        @Override protected void onOpen() { hub.opened(this); }
        @Override protected void onClose(WebSocketFrame.CloseCode code, String reason, boolean initiatedByRemote) { hub.closed(this); }
        @Override protected void onMessage(WebSocketFrame message) { hub.message(this, message.getTextPayload()); }
        @Override protected void onPong(WebSocketFrame pong) { }
        @Override protected void onException(IOException exception) { hub.closed(this); }

        @Override public void ping() throws IOException { ping(new byte[] { 'k', 'a' }); }
        @Override public void close() {
            try { close(WebSocketFrame.CloseCode.GoingAway, "payload swap", false); } catch (IOException ignored) { }
        }
    }
}
