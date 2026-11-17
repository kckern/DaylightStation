package net.kckern.portalkeys;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * The raw request body after NanoHTTPD's parseBody(files).
 *
 * NanoHTTPD 2.3.1 keeps a POST body in files["postData"] but writes a PUT body
 * to a temp file and puts that file's PATH in files["content"]. Reading only
 * postData made every authenticated PUT /lockdown arrive empty, so a Stop was
 * parsed as a release and the Portal's keys never locked (found 2026-11-17).
 */
final class RequestBody {
    private RequestBody() {}

    static String of(Map<String, String> files) throws IOException {
        String posted = files.get("postData");
        if (posted != null) return posted;
        String path = files.get("content");
        if (path == null) return null;
        try (InputStream in = new FileInputStream(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
