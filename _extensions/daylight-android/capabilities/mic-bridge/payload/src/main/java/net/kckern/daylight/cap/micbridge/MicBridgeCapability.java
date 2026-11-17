package net.kckern.daylight.cap.micbridge;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import net.kckern.daylight.cap.micbridge.shell.OverlayAnchor;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Diag;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.StatusBoard;

import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Microphone PCM over a loopback WebSocket for a page whose WebView cannot open the
 * microphone, with the two routes the control API contract fixes: GET /mic/status and
 * POST /mic/restart.
 */
public final class MicBridgeCapability implements Capability {
    private static final String TAG = "AudioBridge";
    /** How long a route or start() waits for the main thread to add or remove the overlay. */
    private static final long MAIN_WAIT_MS = 2000;

    private CoreContext core;
    private volatile Context ctx;
    private volatile MicStreamServer server;

    @Override public String name() { return "mic-bridge"; }

    private JSONObject status() throws Exception {
        MicStreamServer s = server;
        String err = s == null ? null : s.lastError();
        return new JSONObject()
                .put("running", s != null && s.running())
                .put("streaming", s != null && s.streaming())
                .put("clients", s == null ? 0 : s.clients())
                // Capture would not start although the permission is granted: the nearest
                // thing this process can observe to another process holding the microphone.
                .put("heldByOther", s != null && s.captureDenied())
                .put("lastError", err == null ? JSONObject.NULL : err)
                .put("port", s == null ? (Integer) core.settings().get("mic.port") : s.port());
    }

    /**
     * A window can only be added and removed on a thread with a Looper, and removed only
     * on the thread that added it: the shell half adds the anchor on the main thread, so
     * everything this capability does to it goes there too. Returns false when the main
     * thread did not get to it in time.
     */
    private static boolean onMain(final Runnable work) {
        if (Looper.myLooper() == Looper.getMainLooper()) { work.run(); return true; }
        final CountDownLatch done = new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(() -> {
            try { work.run(); } finally { done.countDown(); }
        });
        try {
            return done.await(MAIN_WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    @Override public void register(CoreContext core) {
        this.core = core;
        // audio-bridge's port. A device that still runs audio-bridge beside this app sets another.
        core.settings().declare("mic.port", SettingsRegistry.Type.INTEGER, 8765);

        core.router().route("GET", "/mic/status", req -> Replies.json(status().put("ok", true)));
        core.router().route("POST", "/mic/restart", req -> {
            // Replaces the backend's force-stop and relaunch of the companion app.
            final Context c = ctx;
            MicStreamServer old = server;
            if (c == null || old == null) return Replies.json(status().put("ok", false).put("error", "not_ready"));
            Diag.log(TAG, "/mic/restart from " + req.remote);
            synchronized (this) {
                old.stop();
                onMain(() -> { OverlayAnchor.remove(c); OverlayAnchor.ensure(c); });
                Thread.sleep(OverlayAnchor.SETTLE_MS);
                MicStreamServer fresh = new MicStreamServer(c);
                fresh.start((Integer) core.settings().get("mic.port"));
                server = fresh;
            }
            // "running" means the stream is listening again. Capture starts per client, so
            // "streaming" turns true when the page reconnects.
            JSONObject after = status();
            return Replies.json(after.put("ok", after.getBoolean("running")));
        });
        core.status().add(StatusBoard.Surface.STATUS, name(), o -> o.put("mic", status()));
    }

    @Override public void start() {
        Context shellContext = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: no microphone to stream.
        if (shellContext == null) return;
        final Context c = shellContext.getApplicationContext();
        ctx = c;
        // The shell half put the anchor up at process start; this covers a process in
        // which that failed (the overlay permission was granted after it started).
        onMain(() -> OverlayAnchor.ensure(c));
        MicStreamServer s = new MicStreamServer(c);
        s.start((Integer) core.settings().get("mic.port"));
        server = s;
        if (!s.running()) core.shell().note("PAYLOAD", "mic stream did not start: " + s.lastError());
    }

    @Override public synchronized void stop() {
        MicStreamServer s = server;
        server = null;
        if (s != null) s.stop();
        ctx = null;
        // The anchor stays: it belongs to the process, and the next payload needs it.
    }
}
