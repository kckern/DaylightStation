package net.kckern.daylight.cap.micbridge;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import net.kckern.daylight.cap.micbridge.shell.OverlayAnchor;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Diag;
import net.kckern.daylight.core.LiveSwitch;
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

    /** The overlay window that keeps the microphone available to a background process. */
    interface Overlay {
        void ensure(Context c);
        /** Remove and add again, then wait for the window to settle. */
        void rebuild(Context c) throws InterruptedException;
    }

    private static final Overlay REAL_OVERLAY = new Overlay() {
        @Override public void ensure(final Context c) { onMain(() -> OverlayAnchor.ensure(c)); }
        @Override public void rebuild(final Context c) throws InterruptedException {
            onMain(() -> { OverlayAnchor.remove(c); OverlayAnchor.ensure(c); });
            Thread.sleep(OverlayAnchor.SETTLE_MS);
        }
    };

    private CoreContext core;
    private volatile Context ctx;
    /** Read and replaced only while holding this capability's lock. Read without it for status. */
    private volatile MicStreamServer server;
    private volatile Overlay overlay = REAL_OVERLAY;
    /** Outlives a restart, so a restart cannot make a capture failure look cured. */
    private final CaptureState capture = new CaptureState();
    /**
     * mic.enabled: whether this app runs the microphone stream. Off while audio-bridge
     * still streams the same microphone; turned on at the Shield's cutover.
     */
    private LiveSwitch micSwitch;

    /** Test seam: no window manager on the JVM. */
    void useOverlayForTest(Overlay o) { overlay = o; }
    CaptureState captureForTest() { return capture; }

    @Override public String name() { return "mic-bridge"; }

    private JSONObject status() throws Exception {
        MicStreamServer s = server;
        String code = s == null ? null : s.errorCode();
        String detail = s == null ? null : s.lastError();
        return new JSONObject()
                .put("running", s != null && s.running())
                .put("streaming", s != null && s.streaming())
                .put("clients", s == null ? 0 : s.clients())
                // Capture would not start although the permission is granted: the nearest
                // thing this process can observe to another process holding the microphone.
                .put("heldByOther", s != null && s.captureDenied())
                // A stable code: bind_failed, capture_denied or permission_missing. capture_denied
                // stays until a capture really starts; POST /mic/restart does not clear it.
                .put("lastError", code == null ? JSONObject.NULL : code)
                .put("lastErrorDetail", detail == null ? JSONObject.NULL : detail)
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
        core.settings().declare("mic.port", SettingsRegistry.Type.INTEGER, 8765, SettingsRegistry.range(1024, 65535));
        // A client that sends no Origin header is admitted from loopback while this is true.
        // True for as long as an app other than this one's kiosk hosts the page; see MicOriginRule.
        core.settings().declare("mic.allowNoOrigin", SettingsRegistry.Type.BOOLEAN, true);
        micSwitch = LiveSwitch.declare(core, "mic.enabled", new LiveSwitch.Part() {
            @Override public void acquire() { startStream(ctx); }
            @Override public void release() { stopStream(); }
        });

        core.router().route("GET", "/mic/status", req -> Replies.json(status().put("ok", true)));
        core.router().route("POST", "/mic/restart", req -> {
            // Replaces the backend's force-stop and relaunch of the companion app.
            Diag.log(TAG, "/mic/restart from " + req.remote);
            if (!restart()) return Replies.json(status().put("ok", false).put("error", "not_ready"));
            // "running" means the stream is listening again. Capture starts per client, so
            // "streaming" turns true when the page reconnects.
            JSONObject after = status();
            return Replies.json(after.put("ok", after.getBoolean("running")));
        });
        core.status().add(StatusBoard.Surface.STATUS, name(), o -> o.put("mic", status()));
    }

    /**
     * Stop the stream server, rebuild the overlay, start a new server. The whole swap
     * holds the lock, and the server is read inside it: two overlapping calls then run
     * one after the other, each stopping the server the one before it started. Read
     * outside the lock, both would stop the same old server and start one each on the
     * same port; the loser would replace the winner in `server`, and the winner would
     * keep the port with nothing left to stop it.
     * False when the stream was never started.
     */
    synchronized boolean restart() throws InterruptedException {
        MicStreamServer old = server;
        if (old == null) return false;
        Context c = ctx;
        old.stop();
        overlay.rebuild(c);
        MicStreamServer fresh = newServer(c);
        fresh.start((Integer) core.settings().get("mic.port"));
        server = fresh;
        return true;
    }

    private MicStreamServer newServer(Context c) {
        return new MicStreamServer(c, capture, (origin, loopback) ->
                MicOriginRule.admits(origin, startUrl(), loopback, (Boolean) core.settings().get("mic.allowNoOrigin")));
    }

    /** The kiosk's start URL, read at each handshake. Null on a device without webview-host. */
    private String startUrl() {
        try {
            return (String) core.settings().get("webview.startUrl");
        } catch (SettingsRegistry.UnknownSettingException noKiosk) {
            return null;
        }
    }

    @Override public void start() {
        Context shellContext = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: no microphone to stream.
        if (shellContext == null) return;
        ctx = shellContext.getApplicationContext();
        micSwitch.start();
    }

    /** The context is null only in a JVM test, which also replaces the overlay. */
    synchronized void startStream(Context c) {
        ctx = c;
        // The shell half put the anchor up at process start; this covers a process in
        // which that failed (the overlay permission was granted after it started).
        overlay.ensure(c);
        MicStreamServer s = newServer(c);
        s.start((Integer) core.settings().get("mic.port"));
        server = s;
        if (!s.running()) core.shell().note("PAYLOAD", "mic stream did not start: " + s.lastError());
    }

    /**
     * Not synchronized: the switch takes its own lock before this capability's, and a
     * setting change does the same, so stop() must not hold this one first.
     */
    @Override public void stop() {
        if (micSwitch != null) micSwitch.stop();
        stopStream();
        ctx = null;
        // The anchor stays: it belongs to the process, and the next payload needs it.
    }

    private synchronized void stopStream() {
        MicStreamServer s = server;
        server = null;
        if (s != null) s.stop();
    }
}
