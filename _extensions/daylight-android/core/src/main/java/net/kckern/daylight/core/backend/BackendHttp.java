package net.kckern.daylight.core.backend;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Http over HttpURLConnection. The backend is reached over the VPN at a private
 * address, where it trusts the caller by network: no credential is sent, only the
 * device header. Redirects are not followed, so a request never leaves the URL it
 * was built for.
 */
public final class BackendHttp implements Http {
    public interface DeviceHeader { String value(); }

    private static final int CONNECT_MS = 5_000;
    private static final int READ_MS = 30_000;
    /**
     * An upload's answer arrives after the far side has transcribed the audio, saved the
     * entry and sent its reply. A timeout followed by a retry is safe there: the intake
     * is idempotent by memo id.
     */
    static final int UPLOAD_READ_MS = 330_000;
    /** The most of a response body that is kept. The backend's JSON answers are far smaller. */
    private static final int MAX_REPLY_BYTES = 4 * 1024 * 1024;

    private final DeviceHeader device;

    public BackendHttp(DeviceHeader device) { this.device = device; }

    @Override public Reply get(String url) throws IOException {
        return finish(open(url, "GET", READ_MS));
    }

    @Override public Reply postJson(String url, String json) throws IOException {
        HttpURLConnection c = open(url, "POST", READ_MS);
        byte[] bytes = (json == null ? "{}" : json).getBytes(StandardCharsets.UTF_8);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
        return finish(c);
    }

    @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) throws IOException {
        HttpURLConnection c = open(url, "POST", UPLOAD_READ_MS);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", contentType);
        for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
        c.setFixedLengthStreamingMode(file.length());
        try (OutputStream out = c.getOutputStream(); InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return finish(c);
    }

    private HttpURLConnection open(String url, String method, int readMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(CONNECT_MS);
        c.setReadTimeout(readMs);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("X-Daylight-Device", device.value());
        return c;
    }

    private static Reply finish(HttpURLConnection c) throws IOException {
        try {
            int status = c.getResponseCode();
            InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (in != null) {
                try (InputStream body = in) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = body.read(buf)) > 0 && out.size() < MAX_REPLY_BYTES) out.write(buf, 0, n);
                }
            }
            return new Reply(status, new String(out.toByteArray(), StandardCharsets.UTF_8));
        } finally {
            c.disconnect();
        }
    }
}
