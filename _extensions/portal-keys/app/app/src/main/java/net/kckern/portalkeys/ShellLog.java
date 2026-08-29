package net.kckern.portalkeys;

import android.content.Context;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

final class ShellLog {
    private static File file;
    static void install(Context c) { file = new File(c.getFilesDir(), "shell.log"); }
    static synchronized void note(String kind, String msg) {
        Log.i("PortalKeys-Shell", kind + ": " + msg);
        if (file == null) return;
        String line = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()) + " " + kind + ": " + msg + "\n";
        try (FileOutputStream out = new FileOutputStream(file, true)) { out.write(line.getBytes(StandardCharsets.UTF_8)); }
        catch (Exception ignored) { }
    }
    static File file() { return file; }
}
