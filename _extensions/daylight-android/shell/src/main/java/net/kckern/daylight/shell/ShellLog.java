package net.kckern.daylight.shell;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * ShellLog is the shell's own durable log, separate from anything a payload writes.
 *
 * Payload events (fetch, verify, activate, rollback) are the record needed when a
 * device comes back in an unexpected state, and they must outlive the payload they
 * describe. Append-only text in app-private storage, cut back to its newer half
 * when it passes 64 KB, served by the lifeline's {@code GET /log}, and mirrored
 * to logcat.
 */
public final class ShellLog {

    private static final String TAG = "Daylight-Shell";
    private static final long MAX_BYTES = 64 * 1024;
    private static File file;

    private ShellLog() { }

    public static void install(Context ctx) { installIn(ctx.getFilesDir()); }

    /**
     * The log lives under the app's private files directory. With no directory there
     * is no log file: a relative path would land wherever the process happens to run.
     */
    static synchronized void installIn(File filesDir) {
        if (filesDir == null) { file = null; return; }
        File dir = new File(filesDir, "diag");
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
