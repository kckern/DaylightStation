package net.kckern.pianobridge;

import android.content.Context;
import android.util.Base64;
import java.io.File;
import android.util.AtomicFile;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

final class AdminToken {
    private AdminToken() { }
    static synchronized String get(Context c) {
        File f = new File(c.getFilesDir(), "admin.token");
        try {
            AtomicFile atomic=new AtomicFile(f);
            if (f.isFile() || new File(f.getPath()+".bak").isFile())
                return new String(atomic.readFully(), StandardCharsets.UTF_8).trim();
            byte[] raw = new byte[32]; new SecureRandom().nextBytes(raw);
            String token = Base64.encodeToString(raw, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            FileOutputStream stream=null;
            try {
                stream=atomic.startWrite(); stream.write((token+"\n").getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(stream);
            } catch (Exception failure) { atomic.failWrite(stream); throw failure; }
            return token;
        } catch (Exception e) { throw new IllegalStateException("admin token unavailable", e); }
    }
}
