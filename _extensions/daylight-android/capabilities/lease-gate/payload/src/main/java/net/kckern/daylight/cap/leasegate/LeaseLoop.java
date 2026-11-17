package net.kckern.daylight.cap.leasegate;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import net.kckern.daylight.core.spi.PackageGate;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

import javax.net.ssl.HttpsURLConnection;

/**
 * Polls for a lease and enforces it locally. Network I/O can never block the local
 * expiry tick. The tick, poll and accept logic is supervision-guard's GuardService,
 * with DevicePolicyManager replaced by PackageGate. Until something provides a ready
 * PackageGate the loop reports ready:false and treats the gate as closed.
 */
final class LeaseLoop {
    private static final String TAG = "SupervisionGuard";

    /**
     * Everything the loop needs from Android and the network: a clock, a place to run
     * its ticks, a wake lock and the lease request. The real one is {@link Device}; a
     * JVM test drives the loop through a fake, where time moves when the test says so.
     */
    interface Platform {
        /** Milliseconds that only move forward (SystemClock.elapsedRealtime). */
        long nowMs();
        void post(Runnable r);
        void postDelayed(Runnable r, long delayMs);
        void cancelPosted();
        /** Run off the tick's thread. Throws RejectedExecutionException once shut down. */
        void network(Runnable r);
        void shutdownNetwork();
        void holdAwake(long timeoutMs);
        void releaseAwake();
        boolean awakeHeld();
        /** The lease request. Null for any failure: the existing lease then expires locally. */
        JSONObject fetch(String endpoint, String credential, String target, boolean ready, boolean blocked, long epoch, long revision);
    }

    private final Platform platform;
    private final LeaseOrder order;
    private final LeaseDeadline lease;
    private final Supplier<PackageGate> gate;
    private final String endpoint, credential, target;
    /** Whether this device can have a device owner at all (android.software.device_admin). */
    private final boolean deviceAdminFeature;
    private volatile boolean ready = false, blocked = true;
    private boolean fetching = false;
    private volatile boolean stopped = false;

    LeaseLoop(Context ctx, LeaseOrder order, Supplier<PackageGate> gate, String endpoint, String credential, String target) {
        this(new Device(ctx), order, gate, endpoint, credential, target, ctx.getPackageName(),
                ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_DEVICE_ADMIN));
    }

    LeaseLoop(Platform platform, LeaseOrder order, Supplier<PackageGate> gate, String endpoint, String credential, String target,
              String ownPackage, boolean deviceAdminFeature) {
        this.platform = platform;
        this.order = order;
        this.lease = order.load();
        this.gate = gate;
        boolean valid = validConfig(endpoint, credential, target, ownPackage);
        if (!valid) Log.w(TAG, "Local enforcement not provisioned");
        this.endpoint = valid ? endpoint : null;
        this.credential = valid ? credential : null;
        this.target = valid ? target : null;
        this.deviceAdminFeature = deviceAdminFeature;
    }

    static boolean validConfig(String endpoint, String credential, String target, String ownPackage) {
        try {
            URL url = new URL(endpoint);
            return "https".equals(url.getProtocol()) && url.getUserInfo() == null && url.getQuery() == null
                    && credential != null && credential.length() >= 32
                    && target != null && target.matches("[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+")
                    && !target.equals(ownPackage);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Why the target package cannot be hidden here, or null when it can. Hiding a
     * package takes a device owner, and a device without the device-admin feature can
     * never have one.
     */
    static String hidingUnsupportedReason(boolean hasGate, boolean gateReady, boolean deviceAdminFeature) {
        if (hasGate && gateReady) return null;
        if (!deviceAdminFeature) {
            return "this device has no android.software.device_admin feature, so no app can be device owner and no package can be hidden";
        }
        if (hasGate) return "the package gate is not ready: this app is not device owner";
        return "no capability in this build provides a package gate";
    }

    void start() {
        enforce(true);
        platform.post(tick);
        platform.post(poll);
    }

    /**
     * After this the package is blocked and stays blocked: `stopped` is set before the
     * last enforce, and enforce turns every later request to unblock into a block. A
     * lease answer that was already on its way to the tick thread therefore cannot
     * reopen the gate of a loop that has stopped. The wake lock is released whatever
     * the gate's state.
     */
    void stop() {
        stopped = true;
        platform.cancelPosted();
        lease.revoke();
        enforce(true);
        platform.shutdownNetwork();
        if (platform.awakeHeld()) platform.releaseAwake();
    }

    JSONObject status() throws Exception {
        PackageGate g = gate.get();
        String reason = hidingUnsupportedReason(g != null, g != null && g.ready(), deviceAdminFeature);
        return new JSONObject()
                .put("configured", target != null)
                .put("ready", ready)
                .put("blocked", blocked)
                .put("leaseBlocked", lease.blocked(platform.nowMs()))
                .put("epoch", lease.epoch())
                .put("revision", lease.revision())
                .put("enforcement", g == null ? "unavailable" : "package-gate")
                .put("packageHiding", reason == null ? "supported" : "unsupported")
                .put("packageHidingReason", reason == null ? JSONObject.NULL : reason);
    }

    private synchronized void enforce(boolean desired) {
        // A stopped loop only ever blocks.
        if (stopped) desired = true;
        try {
            PackageGate g = gate.get();
            if (target == null || g == null || !g.ready()) { ready = false; blocked = true; return; }
            try {
                boolean actual = g.isHidden(target);
                if (actual != desired && !g.setHidden(target, desired)) throw new SecurityException();
                blocked = g.isHidden(target);
                ready = blocked == desired;
                if (!ready) lease.revoke();
            } catch (Exception error) {
                ready = false;
                lease.revoke();
                Log.w(TAG, "Package restriction unverified");
            }
        } finally {
            // On every path, the one with no usable gate included: a block needs no wake lock.
            if (desired && platform.awakeHeld()) platform.releaseAwake();
        }
    }

    private final Runnable tick = new Runnable() {
        public void run() {
            if (stopped) return;
            enforce(lease.blocked(platform.nowMs()));
            platform.postDelayed(this, 100);
        }
    };

    private final Runnable poll = new Runnable() {
        public void run() {
            if (stopped) return;
            if (!fetching && endpoint != null) {
                fetching = true;
                final long started = platform.nowMs();
                final boolean localReady = ready, localBlocked = blocked;
                final long epoch = lease.epoch(), revision = lease.revision();
                try {
                    platform.network(() -> {
                        final JSONObject result = platform.fetch(endpoint, credential, target, localReady, localBlocked, epoch, revision);
                        platform.post(() -> accept(started, result));
                    });
                } catch (java.util.concurrent.RejectedExecutionException shuttingDown) {
                    return;
                }
            }
            platform.postDelayed(this, 1000);
        }
    };

    private static JSONObject fetch(String endpoint, String credential, String target,
                                    boolean localReady, boolean localBlocked, long epoch, long revision) {
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) new URL(endpoint).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(1500);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + credential);
            connection.setRequestProperty("Content-Type", "application/json");
            JSONObject ack = new JSONObject().put("protocol", 1).put("capabilityReady", localReady)
                    .put("blocked", localBlocked).put("epoch", epoch).put("commandRevision", revision);
            byte[] bytes = new JSONObject().put("packageName", target).put("ack", ack).toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            if (connection.getResponseCode() == 200) return new JSONObject(read(connection.getInputStream()));
        } catch (Exception error) {
            // The existing lease expires locally. Never log the bearer or the response.
        } finally {
            if (connection != null) connection.disconnect();
        }
        return null;
    }

    private void accept(long started, JSONObject result) {
        fetching = false;
        if (stopped || result == null) return;
        try {
            if (result.getInt("protocol") != 1) throw new IllegalArgumentException();
            lease.accept(started, platform.nowMs(), result.getLong("epoch"), result.getLong("commandRevision"),
                    result.getBoolean("blockedCommand"), result.getBoolean("allowed"), result.getLong("leaseMs"));
            if (!order.save(lease)) lease.revoke();
            if (!stopped && !lease.blocked(platform.nowMs())) platform.holdAwake(6000);
            enforce(lease.blocked(platform.nowMs()));
        } catch (Exception error) {
            lease.revoke();
            enforce(true);
        }
    }

    private static String read(InputStream stream) throws IOException {
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[1024];
            int length;
            while ((length = in.read(bytes)) != -1) {
                if (out.size() + length > 8192) throw new IOException();
                out.write(bytes, 0, length);
            }
            return out.toString("UTF-8");
        }
    }

    /** The real platform: the main looper, one network thread, a partial wake lock, HTTPS. */
    private static final class Device implements Platform {
        private final Handler handler = new Handler(Looper.getMainLooper());
        private final ExecutorService network = Executors.newSingleThreadExecutor();
        private final PowerManager.WakeLock awake;

        Device(Context ctx) {
            awake = ctx.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Daylight:supervision-lease");
            awake.setReferenceCounted(false);
        }

        @Override public long nowMs() { return SystemClock.elapsedRealtime(); }
        @Override public void post(Runnable r) { handler.post(r); }
        @Override public void postDelayed(Runnable r, long delayMs) { handler.postDelayed(r, delayMs); }
        @Override public void cancelPosted() { handler.removeCallbacksAndMessages(null); }
        @Override public void network(Runnable r) { network.execute(r); }
        @Override public void shutdownNetwork() { network.shutdownNow(); }
        @Override public void holdAwake(long timeoutMs) { awake.acquire(timeoutMs); }
        @Override public void releaseAwake() { awake.release(); }
        @Override public boolean awakeHeld() { return awake.isHeld(); }
        @Override public JSONObject fetch(String endpoint, String credential, String target, boolean ready, boolean blocked, long epoch, long revision) {
            return LeaseLoop.fetch(endpoint, credential, target, ready, blocked, epoch, revision);
        }
    }
}
