package net.kckern.daylight.core.backend;

import java.io.File;
import java.io.IOException;
import java.util.Map;

/** The few HTTP calls the app makes to the backend. An interface so tests can fake it. */
public interface Http {
    final class Reply {
        public final int status;
        public final String body;

        public Reply(int status, String body) {
            this.status = status;
            this.body = body == null ? "" : body;
        }

        public boolean ok() { return status >= 200 && status < 300; }
    }

    /** IOException means the backend was not reached (VPN down, no route, timeout). */
    Reply get(String url) throws IOException;

    Reply postJson(String url, String json) throws IOException;

    Reply postFile(String url, String contentType, File file, Map<String, String> headers) throws IOException;
}
