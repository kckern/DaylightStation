package net.kckern.daylight.core.backend;

import java.io.File;
import java.io.IOException;
import java.util.Map;

/** The few HTTP calls the app makes to the backend. An interface so tests can fake it. */
public interface Http {
    final class Reply {
        public final int status;
        public final String body;

        private final Map<String, String> headers;

        public Reply(int status, String body) { this(status, body, null); }

        /** @param headers response headers by name; names are matched without regard to case */
        public Reply(int status, String body, Map<String, String> headers) {
            this.status = status;
            this.body = body == null ? "" : body;
            Map<String, String> lower = new java.util.HashMap<>();
            if (headers != null) {
                for (Map.Entry<String, String> h : headers.entrySet()) {
                    if (h.getKey() != null && h.getValue() != null) lower.put(h.getKey().toLowerCase(java.util.Locale.ROOT), h.getValue());
                }
            }
            this.headers = lower;
        }

        /** A response header's value, or null. */
        public String header(String name) { return name == null ? null : headers.get(name.toLowerCase(java.util.Locale.ROOT)); }

        public boolean ok() { return status >= 200 && status < 300; }
    }

    /**
     * An upload failed before its body had been written: no connection, a connect
     * timeout, a link that dropped part-way. The far side has not received the request.
     * Never a SocketTimeoutException, so a caller can tell it from a request that was
     * sent and not answered in time.
     */
    final class NotSentException extends IOException {
        public NotSentException(IOException cause) {
            super("not sent: " + cause.getClass().getSimpleName());
            initCause(cause);
        }
    }

    /** IOException means the backend was not reached (VPN down, no route, timeout). */
    Reply get(String url) throws IOException;

    Reply postJson(String url, String json) throws IOException;

    /**
     * @throws NotSentException                 the body was not (wholly) written
     * @throws java.net.SocketTimeoutException  the body was written and no answer came in time
     * @throws IOException                      the body was written and the link failed before an answer
     */
    Reply postFile(String url, String contentType, File file, Map<String, String> headers) throws IOException;
}
