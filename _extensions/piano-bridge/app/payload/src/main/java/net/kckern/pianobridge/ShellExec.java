package net.kckern.pianobridge;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * ShellExec — run a shell command as the bridge's own app uid and capture output.
 *
 * This is the engine behind the ADB-replacement control-plane endpoints (/exec,
 * /cpu, /top, /logcat, /dumpsys, …). Commands run as uid app_xxx, NOT shell (2000),
 * so the Android app sandbox is the security boundary: destructive ops on other
 * apps' data or the system fail on permission, while diagnostics that the granted
 * DUMP / READ_LOGS perms unlock (dumpsys, logcat) succeed. No allowlist — the
 * sandbox already bounds the blast radius, and the kiosk LAN trust model matches
 * the unauthenticated Fully REST endpoint.
 *
 * Both stdout and stderr are drained on separate threads so a command that fills
 * one pipe buffer while we block on the other can't deadlock. Output is capped at
 * ~1 MB per stream to keep a runaway `logcat` from exhausting memory.
 */
public final class ShellExec {

    private static final int MAX_BYTES = 1_000_000;

    private ShellExec() { }

    /** Run {@code cmd} via {@code sh -c}, returning {ok, cmd, exit, stdout, stderr, ms[, timeout]}. */
    public static JSONObject run(String cmd, int timeoutMs) {
        JSONObject o = new JSONObject();
        long t0 = System.currentTimeMillis();
        try {
            Process p = new ProcessBuilder("sh", "-c", cmd).redirectErrorStream(false).start();
            Gobbler out = new Gobbler(p.getInputStream());
            Gobbler err = new Gobbler(p.getErrorStream());
            out.start();
            err.start();
            boolean done = p.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!done) { p.destroyForcibly(); o.put("timeout", true); }
            out.join(2000);
            err.join(2000);
            o.put("ok", true);
            o.put("cmd", cmd);
            o.put("exit", done ? p.exitValue() : -1);
            o.put("stdout", out.text());
            o.put("stderr", err.text());
        } catch (Exception e) {
            try { o.put("ok", false).put("cmd", cmd).put("error", String.valueOf(e.getMessage())); }
            catch (Exception ignored) { }
        }
        try { o.put("ms", System.currentTimeMillis() - t0); } catch (Exception ignored) { }
        return o;
    }

    /** Drains a stream on its own thread into a capped buffer. */
    private static final class Gobbler extends Thread {
        private final InputStream in;
        private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
        Gobbler(InputStream in) { this.in = in; setDaemon(true); }

        @Override public void run() {
            byte[] b = new byte[4096];
            int n;
            try {
                while ((n = in.read(b)) > 0) {
                    if (buf.size() < MAX_BYTES) buf.write(b, 0, Math.min(n, MAX_BYTES - buf.size()));
                }
            } catch (Exception ignored) { }
        }

        String text() { return new String(buf.toByteArray(), StandardCharsets.UTF_8); }
    }
}
