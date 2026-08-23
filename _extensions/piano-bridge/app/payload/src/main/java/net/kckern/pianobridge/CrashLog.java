package net.kckern.pianobridge;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.PrintWriter;
import java.io.RandomAccessFile;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * CrashLog — DURABLE, on-disk lifecycle/crash record that survives the process.
 *
 * The problem it fixes: {@link Diag} is an in-memory ring that dies WITH the process,
 * so when the bridge crashed or was killed we learned nothing about why (the whole
 * reason the kiosk went dark on 2026-07-03 was unrecoverable after the fact). This
 * writes to the app's external files dir, which survives process death and reboot:
 *
 *   diag/events.log   append-only ring of lifecycle + recovery + crash lines
 *   diag/running      presence marker: written on start, deleted on CLEAN shutdown.
 *                     Present at next start ⇒ the previous exit was UNCLEAN (kill,
 *                     native crash, or a device reboot).
 *   diag/reboot.ts    epoch-ms of the last watchdog-triggered reboot — the reboot
 *                     cap MUST persist here or a reboot (which restarts this process)
 *                     would reset an in-memory counter and boot-loop.
 *
 * Java uncaught exceptions are captured with a stacktrace; native SIGSEGV (sfizz/
 * Oboe) won't reach the Java handler, but the running-marker still flags that the
 * death was unclean. A native breakpad handler is a future follow-up.
 */
public final class CrashLog {

    private static final String TAG = "PianoBridge-Crash";
    private static final long MAX_EVENTS_BYTES = 128 * 1024;

    private static File dir;
    private static volatile boolean prevDeathUnclean = false;

    private CrashLog() { }

    /**
     * Wire up durable logging. Call once from Service.onCreate BEFORE anything that
     * might crash. Detects an unclean previous death, then (re)arms the marker and
     * the uncaught-exception handler.
     */
    public static synchronized void install(Context ctx) {
        try {
            dir = new File(ctx.getExternalFilesDir(null), "diag");
            if (!dir.exists()) dir.mkdirs();

            File marker = new File(dir, "running");
            prevDeathUnclean = marker.exists();
            if (prevDeathUnclean) {
                note("LIFECYCLE", "start AFTER UNCLEAN death (kill/native-crash/reboot) — marker was present");
            } else {
                note("LIFECYCLE", "start after clean shutdown");
            }
            writeFile(marker, String.valueOf(System.currentTimeMillis()));

            final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler((thread, ex) -> {
                try {
                    StringWriter sw = new StringWriter();
                    ex.printStackTrace(new PrintWriter(sw));
                    note("CRASH", "thread=" + thread.getName() + " " + sw.toString().replace('\n', '⏎'));
                    snapshotDiag();
                } catch (Throwable ignored) { }
                if (prev != null) prev.uncaughtException(thread, ex); // keep the system's dialog/kill
            });
        } catch (Throwable t) {
            Log.e(TAG, "install failed", t);
        }
    }

    /** Record a clean shutdown so the next start isn't misread as a crash. */
    public static synchronized void markCleanShutdown() {
        try {
            note("LIFECYCLE", "clean shutdown");
            File marker = new File(dir, "running");
            if (marker.exists()) marker.delete();
        } catch (Throwable ignored) { }
    }

    /** Append one timestamped line to the durable event ring. Also mirrors to Diag. */
    public static synchronized void note(String kind, String msg) {
        Diag.log("PianoBridge-Crash", kind + ": " + msg);
        if (dir == null) return;
        try {
            File f = new File(dir, "events.log");
            String line = System.currentTimeMillis() + " +" + SystemClock.elapsedRealtime()
                    + " [" + kind + "] " + msg + "\n";
            appendCapped(f, line);
        } catch (Throwable ignored) { }
    }

    /** Snapshot the in-memory Diag ring to disk (called on crash so recent events survive). */
    public static synchronized void snapshotDiag() {
        if (dir == null) return;
        try {
            JSONArray recent = Diag.recent();
            writeFile(new File(dir, "diag-snapshot.json"), recent.toString());
        } catch (Throwable ignored) { }
    }

    // --- reboot cap (persisted across the reboot itself) ---------------------

    public static synchronized long lastRebootAt() {
        if (dir == null) return 0L;
        try {
            String s = readFile(new File(dir, "reboot.ts"));
            return s == null || s.trim().isEmpty() ? 0L : Long.parseLong(s.trim());
        } catch (Throwable t) { return 0L; }
    }

    public static synchronized void recordReboot() {
        note("RECOVERY", "recording watchdog reboot timestamp (cap persists across the reboot)");
        if (dir != null) writeFile(new File(dir, "reboot.ts"), String.valueOf(System.currentTimeMillis()));
    }

    public static boolean prevDeathUnclean() { return prevDeathUnclean; }

    /** Machine-readable dump for GET /crashlog. */
    public static synchronized JSONObject read() {
        JSONObject o = new JSONObject();
        try {
            o.put("prevDeathUnclean", prevDeathUnclean);
            o.put("lastRebootAt", lastRebootAt());
            o.put("events", tail(new File(dir, "events.log"), 120));
            String snap = readFile(new File(dir, "diag-snapshot.json"));
            o.put("lastCrashDiagSnapshot", snap == null ? JSONObject.NULL : new JSONArray(snap));
            o.put("ok", true);
        } catch (Throwable t) {
            try { o.put("ok", false).put("error", String.valueOf(t.getMessage())); } catch (Throwable ignored) { }
        }
        return o;
    }

    // --- file helpers --------------------------------------------------------

    private static JSONArray tail(File f, int maxLines) {
        JSONArray a = new JSONArray();
        if (f == null || !f.exists()) return a;
        try {
            String all = readFile(f);
            if (all == null) return a;
            String[] lines = all.split("\n");
            Deque<String> keep = new ArrayDeque<>();
            for (String l : lines) { if (!l.isEmpty()) keep.addLast(l); while (keep.size() > maxLines) keep.removeFirst(); }
            for (String l : keep) a.put(l);
        } catch (Throwable ignored) { }
        return a;
    }

    private static void appendCapped(File f, String line) {
        try {
            // Cheap size cap: if the file exceeds the budget, rewrite it keeping the tail.
            if (f.exists() && f.length() > MAX_EVENTS_BYTES) {
                String all = readFile(f);
                if (all != null && all.length() > MAX_EVENTS_BYTES / 2) {
                    all = all.substring(all.length() - (int) (MAX_EVENTS_BYTES / 2));
                    int nl = all.indexOf('\n');
                    if (nl >= 0) all = all.substring(nl + 1);
                    writeFile(f, all);
                }
            }
            try (RandomAccessFile raf = new RandomAccessFile(f, "rw")) {
                raf.seek(raf.length());
                raf.write(line.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Throwable ignored) { }
    }

    private static void writeFile(File f, String content) {
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        } catch (Throwable ignored) { }
    }

    private static String readFile(File f) {
        if (f == null || !f.exists()) return null;
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            byte[] b = new byte[(int) Math.min(raf.length(), MAX_EVENTS_BYTES * 2)];
            raf.readFully(b);
            return new String(b, StandardCharsets.UTF_8);
        } catch (Throwable t) { return null; }
    }
}
