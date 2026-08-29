package net.kckern.portalkeys;

import android.content.Context;
import android.util.Base64;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;

final class AdminToken {
    private AdminToken() { }
    static synchronized String get(Context c) {
        File f = new File(c.getFilesDir(), "admin.token");
        try {
            if (f.isFile()) return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim();
            byte[] raw = new byte[32]; new SecureRandom().nextBytes(raw);
            String token = Base64.encodeToString(raw, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            Files.write(f.toPath(), (token + "\n").getBytes(StandardCharsets.UTF_8));
            return token;
        } catch (Exception e) { throw new IllegalStateException("admin token unavailable", e); }
    }
}
