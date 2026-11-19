package net.kckern.daylight.core;

import net.kckern.daylight.api.CappedCopy;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

final class Downloads {
    /** The largest self-update APK accepted. The shell APK with native libraries is well under it. */
    static final long MAX_UPDATE_BYTES = 256L * 1024 * 1024;

    private Downloads() { }

    /**
     * Download a URL to a file, following redirects, giving up past the limit.
     * Returns the byte count. `what` names the download in the error.
     */
    static long to(String url, File dest, long limit, String what) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(dest)) {
            CappedCopy.checkDeclaredLength(c.getContentLengthLong(), limit, what);
            long total = CappedCopy.copy(in, out, limit, what);
            out.flush();
            return total;
        } finally {
            c.disconnect();
        }
    }
}
