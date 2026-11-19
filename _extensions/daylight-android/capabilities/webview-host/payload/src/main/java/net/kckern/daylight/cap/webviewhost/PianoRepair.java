package net.kckern.daylight.cap.webviewhost;

import net.kckern.daylight.core.spi.PianoOutput;
import org.json.JSONObject;
import java.util.concurrent.Executor;
import java.util.concurrent.FutureTask;

/** Keep the instrument's multi-step recovery off the WebView bridge thread. */
final class PianoRepair {
    private FutureTask<JSONObject> job;
    private String owner;

    synchronized boolean start(String token, PianoOutput out, Executor worker) {
        if (job != null && !job.isDone()) return false;
        owner = token;
        job = new FutureTask<>(out::repair);
        worker.execute(job);
        return true;
    }

    synchronized String result(String token) throws Exception {
        if (job == null || !token.equals(owner)) return "";
        if (!job.isDone()) return "{\"pending\":true}";
        JSONObject raw;
        try { raw = job.get(); } catch (Exception failure) { raw = null; }
        if (raw == null) return "{\"fixed\":false,\"reason\":\"unavailable\"}";
        JSONObject report = new JSONObject().put("fixed", raw.optBoolean("fixed"));
        // Only instrument verdicts and the recovery rung belong in page data.
        for (String key : new String[]{"reason", "recoveredAt", "verdict", "linkVerdict"})
            if (raw.opt(key) instanceof String) report.put(key, raw.getString(key));
        return report.toString();
    }

    synchronized void stop() { if (job != null) job.cancel(true); }
}
