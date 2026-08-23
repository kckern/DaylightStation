package net.kckern.pianobridge;

import android.system.Os;
import android.system.OsConstants;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ProcStats — per-THREAD CPU for the bridge's OWN process, read in-process.
 *
 * Why in-process: on this Knox-hardened Android 10, an untrusted_app is SELinux-
 * denied /proc/stat, /proc/loadavg, dumpsys, and every other process's /proc. The
 * one thing it CAN always read is its own /proc/self — but only from within the
 * app process itself (a forked `sh` from /exec sees only the shell's lone thread).
 * So this samples /proc/self/task/<tid>/stat directly from the NanoHTTPD worker
 * thread, where the audio, BLE, WS, and HTTP threads are all visible.
 *
 * It answers the only CPU question we CAN answer without ADB/root: "is the bridge
 * (or one of its threads — the synth, the BLE connector) the thing spinning?"
 * Other-process CPU (system_server, the Fully WebView) is unreachable here; that
 * needs `adb shell dumpsys cpuinfo` (shell uid) and has no in-app equivalent.
 */
public final class ProcStats {

    private ProcStats() { }

    private static long hz() {
        try { return Os.sysconf(OsConstants._SC_CLK_TCK); } catch (Throwable t) { return 100L; }
    }

    /** Jiffies (utime+stime) for one /proc/.../stat file, or -1 if unreadable. */
    private static long jiffies(File stat) {
        try (RandomAccessFile f = new RandomAccessFile(stat, "r")) {
            byte[] b = new byte[2048];
            int n = f.read(b);
            if (n <= 0) return -1;
            String s = new String(b, 0, n, StandardCharsets.UTF_8);
            // Fields after "(comm)": the comm can contain spaces/parens, so split
            // on the LAST ')'. Remaining tokens are fields 3.. ; utime=14, stime=15.
            int rp = s.lastIndexOf(')');
            if (rp < 0) return -1;
            String[] t = s.substring(rp + 2).trim().split("\\s+");
            // t[0]=state(field3); utime=field14 -> t[11], stime=field15 -> t[12].
            if (t.length < 13) return -1;
            return Long.parseLong(t[11]) + Long.parseLong(t[12]);
        } catch (Exception e) {
            return -1;
        }
    }

    private static String comm(int tid) {
        try (RandomAccessFile f = new RandomAccessFile("/proc/self/task/" + tid + "/comm", "r")) {
            byte[] b = new byte[64];
            int n = f.read(b);
            return n > 0 ? new String(b, 0, n, StandardCharsets.UTF_8).trim() : String.valueOf(tid);
        } catch (Exception e) {
            return String.valueOf(tid);
        }
    }

    private static int[] tids() {
        String[] names = new File("/proc/self/task").list();
        if (names == null) return new int[0];
        int[] out = new int[names.length];
        int k = 0;
        for (String s : names) { try { out[k++] = Integer.parseInt(s); } catch (NumberFormatException ignored) { } }
        return java.util.Arrays.copyOf(out, k);
    }

    /**
     * Sample own per-thread CPU over {@code intervalMs}. Returns
     * {ok, hz, intervalMs, processCpuPct, threadCount, threads:[{tid,name,cpuPct}…] desc}.
     */
    public static JSONObject sample(int intervalMs) {
        JSONObject o = new JSONObject();
        long h = hz();
        int interval = Math.max(100, Math.min(intervalMs, 5000));

        Map<Integer, Long> first = new HashMap<>();
        for (int tid : tids()) {
            long j = jiffies(new File("/proc/self/task/" + tid + "/stat"));
            if (j >= 0) first.put(tid, j);
        }
        long procFirst = jiffies(new File("/proc/self/stat"));

        try { Thread.sleep(interval); } catch (InterruptedException ignored) { }

        double secs = interval / 1000.0;
        double denom = h * secs;
        List<JSONObject> rows = new ArrayList<>();
        try {
            for (int tid : tids()) {
                Long f = first.get(tid);
                if (f == null) continue;
                long j = jiffies(new File("/proc/self/task/" + tid + "/stat"));
                if (j < 0) continue;
                double pct = denom > 0 ? 100.0 * (j - f) / denom : 0;
                JSONObject r = new JSONObject();
                r.put("tid", tid);
                r.put("name", comm(tid));
                r.put("cpuPct", Math.round(pct * 10) / 10.0);
                rows.add(r);
            }
            rows.sort((a, b) -> Double.compare(b.optDouble("cpuPct"), a.optDouble("cpuPct")));
            long procNow = jiffies(new File("/proc/self/stat"));
            double procPct = (denom > 0 && procFirst >= 0 && procNow >= 0)
                    ? 100.0 * (procNow - procFirst) / denom : -1;

            o.put("ok", true);
            o.put("hz", h);
            o.put("intervalMs", interval);
            o.put("processCpuPct", procPct < 0 ? -1 : Math.round(procPct * 10) / 10.0);
            o.put("threadCount", rows.size());
            o.put("threads", new JSONArray(rows));
            o.put("note", "OWN process only — other-app/system CPU needs adb shell dumpsys (shell uid), unreachable from untrusted_app");
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o;
    }
}
