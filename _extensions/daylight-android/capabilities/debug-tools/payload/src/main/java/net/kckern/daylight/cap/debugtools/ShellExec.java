package net.kckern.daylight.cap.debugtools;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * ShellExec — run a command as the app's own uid and capture its output.
 *
 * Commands run as uid app_xxx, NOT shell (2000), so the Android app sandbox is the
 * security boundary: destructive ops on other apps' data or the system fail on
 * permission, while diagnostics that the granted READ_LOGS permission opens (logcat)
 * succeed. No allowlist: the sandbox bounds the damage, the route needs the device
 * token, and it answers 501 unless debug.execEnabled is true.
 *
 * Both stdout and stderr are drained on separate threads so a command that fills
 * one pipe buffer while we block on the other can't deadlock. Each stream is kept up
 * to MAX_BYTES and then cut, with a marker saying so; the rest is read and dropped
 * so the command is not left blocked on a full pipe.
 *
 * A command past its timeout has its process killed. A child that process started and
 * that outlives it is not followed.
 */
final class ShellExec {

    static final int MAX_BYTES = 256 * 1024;
    static final String TRUNCATED = "\n[truncated: output passed " + MAX_BYTES + " bytes]\n";

    private ShellExec() { }

    /** Run {@code cmd} via {@code sh -c}. The string is the shell's, metacharacters and all. */
    static JSONObject run(String cmd, int timeoutMs) {
        return exec(new String[] { "sh", "-c", cmd }, timeoutMs);
    }

    /**
     * Run an argument list with no shell, returning
     * {ok, exit, stdout, stderr, stdoutTruncated, stderrTruncated, ms[, timeout]}, or {ok:false, error, ms}.
     * The command is not repeated in the result.
     */
    static JSONObject exec(String[] argv, int timeoutMs) {
        JSONObject o = new JSONObject();
        long t0 = System.currentTimeMillis();
        try {
            Process p = new ProcessBuilder(argv).redirectErrorStream(false).start();
            Gobbler out = new Gobbler(p.getInputStream());
            Gobbler err = new Gobbler(p.getErrorStream());
            out.start();
            err.start();
            boolean done = p.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!done) { p.destroyForcibly(); o.put("timeout", true); }
            out.join(2000);
            err.join(2000);
            o.put("ok", true);
            o.put("exit", done ? p.exitValue() : -1);
            o.put("stdout", out.text());
            o.put("stderr", err.text());
            o.put("stdoutTruncated", out.truncated());
            o.put("stderrTruncated", err.truncated());
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); }
            catch (Exception ignored) { }
        }
        try { o.put("ms", System.currentTimeMillis() - t0); } catch (Exception ignored) { }
        return o;
    }

    /** Drains a stream on its own thread into a capped buffer. */
    private static final class Gobbler extends Thread {
        private final InputStream in;
        private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
        private volatile boolean truncated;
        Gobbler(InputStream in) { this.in = in; setDaemon(true); }

        @Override public void run() {
            byte[] b = new byte[4096];
            int n;
            try {
                while ((n = in.read(b)) > 0) {
                    int room;
                    synchronized (buf) {
                        room = MAX_BYTES - buf.size();
                        if (room > 0) buf.write(b, 0, Math.min(n, room));
                    }
                    if (n > room) truncated = true;
                }
            } catch (Exception ignored) { }
        }

        boolean truncated() { return truncated; }

        String text() {
            String text;
            synchronized (buf) { text = new String(buf.toByteArray(), StandardCharsets.UTF_8); }
            return truncated ? text + TRUNCATED : text;
        }
    }
}
