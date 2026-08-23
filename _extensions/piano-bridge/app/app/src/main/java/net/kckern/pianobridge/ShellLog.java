package net.kckern.pianobridge;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * ShellLog — the shell's own durable log, separate from the payload's CrashLog.
 *
 * Exists because payload events (fetch, verify, activate, ROLLBACK) are exactly the
 * record you need when the tablet comes back looking wrong, and they must survive
 * the payload being swapped out from under them. Append-only text, head-truncated at
 * 64 KB, readable over {@code /exec cat}. Mirrored to logcat.
 */
public final class ShellLog {

    private static final String TAG = "PianoBridge-Shell";
    private static final long MAX_BYTES = 64 * 1024;
    private static File file;

    private ShellLog() { }

    public static synchronized void install(Context ctx) {
        File dir = new File(ctx.getExternalFilesDir(null), "diag");
        if (!dir.exists()) dir.mkdirs();
        file = new File(dir, "shell.log");
    }

    public static synchronized void note(String kind, String msg) {
        String line = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())
                + " " + kind + ": " + msg + "\n";
        Log.i(TAG, kind + ": " + msg);
        if (file == null) return;
        try {
            if (file.length() > MAX_BYTES) truncateHead();
            try (FileOutputStream out = new FileOutputStream(file, true)) {
                out.write(line.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.w(TAG, "shell log write failed: " + e.getMessage());
        }
    }

    private static void truncateHead() throws Exception {
        byte[] all = java.nio.file.Files.readAllBytes(file.toPath());
        int keepFrom = all.length - (int) (MAX_BYTES / 2);
        try (FileOutputStream out = new FileOutputStream(file, false)) {
            out.write(all, keepFrom, all.length - keepFrom);
        }
    }

    public static File file() { return file; }
}
