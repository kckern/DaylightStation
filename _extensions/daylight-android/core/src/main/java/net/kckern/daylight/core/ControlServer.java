package net.kckern.daylight.core;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import fi.iki.elonen.NanoWSD;

/** The NanoHTTPD/NanoWSD adapter. HTTP behavior lives in Router, socket behavior in SocketHub. */
public final class ControlServer extends NanoWSD {
    /** The largest request body the server reads. A longer one is answered 413 and not read. */
    public static final int MAX_BODY_BYTES = 1024 * 1024;

    /** A refused request's body up to this size is discarded so the connection stays usable; above it the connection closes. */
    private static final int DISCARD_LIMIT = 64 * 1024;

    /**
     * How long a connection may sit without sending before the server drops it. With no
     * timeout, a client that opens a connection and goes away holds a thread for good.
     * A WebSocket client stays inside it by answering SocketHub's 3 s keepalive ping.
     */
    public static final int SOCKET_READ_TIMEOUT_MS = 5000;

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
                server.start(SOCKET_READ_TIMEOUT_MS, true);   // daemon thread
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

    /**
     * The token is checked before any of the body is read, so a caller without it
     * cannot make the device buffer an upload. The body is then read by its
     * content-length, for every method, and decoded as UTF-8. NanoHTTPD's own
     * parseBody is not used: it decodes as US-ASCII when the content type names
     * no charset, and it rejects bodies it cannot parse as a form.
     */
    @Override
    protected Response serveHttp(IHTTPSession session) {
        Method method = session.getMethod();
        long declared = declaredLength(session);
        if (!router.authorized(session.getHeaders().get(Auth.HEADER))) {
            return refuse(session, declared, Router.Response.error(401, "unauthorized", "message", null));
        }
        if (declared < 0) {
            return closing(Router.Response.error(400, "bad_request", "message", "content-length is not a number"));
        }
        if (declared == 0 && session.getHeaders().get("transfer-encoding") != null) {
            return closing(Router.Response.error(411, "length_required", "message", "send a content-length"));
        }
        if (declared > MAX_BODY_BYTES) {
            return closing(Router.Response.error(413, "payload_too_large", "message",
                    "body is over " + MAX_BODY_BYTES + " bytes"));
        }
        String body = null;
        if (declared > 0) {
            byte[] bytes = new byte[(int) declared];
            try {
                if (!readFully(session.getInputStream(), bytes)) {
                    return closing(Router.Response.error(400, "bad_request", "message", "body is shorter than its content-length"));
                }
            } catch (IOException e) {
                return closing(Router.Response.error(400, "bad_request", "message", "unreadable body"));
            }
            body = new String(bytes, StandardCharsets.UTF_8);
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

    /** The content-length header: 0 when absent, -1 when it is not a non-negative number. */
    private static long declaredLength(IHTTPSession session) {
        String raw = session.getHeaders().get("content-length");
        if (raw == null) return 0;
        try {
            long n = Long.parseLong(raw.trim());
            return n < 0 ? -1 : n;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static boolean readFully(InputStream in, byte[] into) throws IOException {
        int off = 0;
        while (off < into.length) {
            int n = in.read(into, off, into.length - off);
            if (n < 0) return false;
            off += n;
        }
        return true;
    }

    /**
     * Refuse a request whose body has not been read. A small body is read and
     * discarded so the next request on the connection parses; anything else
     * closes the connection, since the unread bytes would be taken for a request.
     */
    private static Response refuse(IHTTPSession session, long declared, Router.Response r) {
        if (declared == 0) return respond(r);
        if (declared > 0 && declared <= DISCARD_LIMIT) {
            try {
                if (readFully(session.getInputStream(), new byte[(int) declared])) return respond(r);
            } catch (IOException ignored) { }
        }
        return closing(r);
    }

    private static Response closing(Router.Response r) {
        Response response = respond(r);
        response.closeConnection(true);
        return response;
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
        /**
         * Closing the request's input stream closes the socket under it, which ends a
         * write that is blocked on a peer that does not read. No frame is written.
         */
        @Override public void abort() {
            try { getHandshakeRequest().getInputStream().close(); } catch (Throwable ignored) { }
        }
    }
}
