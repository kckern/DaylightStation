package net.kckern.daylight.core;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

final class Downloads {
    private Downloads() { }

    /** Download a URL to a file, following redirects. Returns the byte count. */
    static long to(String url, File dest) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[65536];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; }
            out.flush();
            return total;
        } finally {
            c.disconnect();
        }
    }
}
